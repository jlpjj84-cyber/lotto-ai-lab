import { featuresText, reasonFor, referenceFor } from './selection-evidence.js';
import { STRATEGIES } from './lotto-strategies.js';
import { MISSING_SELECTION, recommendationNarration } from './recommendation-narration.js';

const names = new Map(STRATEGIES);
const narrationTitle = 'LOTTO LAB 추천 해설';
const sanitize = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const kst = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
const format = value => Number.isFinite(value) ? value.toFixed(3) : '—';
const status = adjusted => !Number.isFinite(adjusted) ? '검증 불충분 또는 기준 전략' : adjusted > .05 ? '우위 미입증' : '해당 과거 구간에서 유의한 편차';
const scope = info => `${info.first}~${info.last}회 · ${info.settings?.window ? `이동 학습창 ${info.settings.window}회` : '확장 학습창'}`;

export function validationText(research) {
  const b = research?.validation?.backtest;
  const m = research?.validation?.monteCarlo;
  return [
    b ? `생성 시점 워크포워드 ${scope(b)} · ${b.rounds}회 / ${b.games}게임 · 평균 ${format(b.mean)}개 · 같은 기간 무작위 대비 ${format(b.pairedDelta)}개 · 보정 p ${format(b.adjusted)} · ${status(b.adjusted)}`
      : '생성 당시 저장된 워크포워드 결과 없음',
    m ? `생성 시점 몬테카를로 ${scope(m)} · ${m.mode === 'adaptive' ? '순차 갱신' : '조합 고정'} · ${m.repetitions}회 · 시드 ${m.seed} · 보정 p ${format(m.adjusted)} · ${status(m.adjusted)}`
      : '생성 당시 저장된 몬테카를로 결과 없음',
  ];
}

function conditions(selection, options) {
  return [
    options?.uniqueLines && '동일 6개 조합 제외',
    options?.spread && '게임 간 번호 중복 금지',
    selection?.disjoint && !options?.spread && '전략 배치 안에서 선택된 번호 제외',
    selection?.method === 'pattern' && '홀짝 3:3 · 합계 100~149 · 연속 1쌍 이상 · 동일 조합 제외',
    selection?.shared && '공통 무작위 게임',
  ].filter(Boolean).join(' · ') || '게임 내 6개 번호 비복원 선택';
}

function gameNarration(line, game, context) {
  if (!Array.isArray(game?.reference) || !Array.isArray(game.features?.bands) ||
      !Array.isArray(game.features?.runs) || !game.features.runs.every(Array.isArray)) return null;
  return recommendationNarration(line, game, context);
}

export function evidenceHTML(line, evidence, index, context) {
  const game = evidence?.lines?.[index];
  const summary = gameNarration(line, game, { ...context, validation: evidence?.validation });
  if (!summary) return `<p class="research-help">${MISSING_SELECTION}</p>`;
  return `<div class="recommendation-narration"><p class="recommendation-narration-title">${narrationTitle}</p><p>${sanitize(summary)}</p></div>` +
    '<details class="research-method recommendation-detail"><summary>자세한 선정 근거 보기</summary>' +
    `<p class="research-help">선택 조건 · ${sanitize(conditions(game.selection, context?.options))}</p>` +
    '<div class="tablewrap research-table" tabindex="0" aria-label="번호별 선정 근거"><table class="datatable"><thead>' +
    '<tr><th>번호</th><th>실제 선정 근거</th><th>참고 통계</th></tr></thead><tbody>' +
    line.map(number => `<tr><td>${number}</td><td>${sanitize(reasonFor(game.selection, number))}</td>` +
      `<td>${sanitize(referenceFor(evidence, game.reference.find(row => row?.number === number)))}</td></tr>`).join('') +
    `</tbody></table></div><p class="research-help">선택 후 조합 통계 · ${sanitize(featuresText(game.features))}</p></details>`;
}

export function recommendationReport(record) {
  const research = record.research;
  const lines = [`${record.round}회 추천 보고서 · ${names.get(record.strategy)} v${record.version}`,
    `생성 ${kst(record.generatedAtUTC)} KST · 기준 ${record.dataRound}회 · 시드 ${record.seed}`];
  if (research?.data) lines.push(`데이터 ${research.data.first}~${research.data.last}회 · SHA-256 ${research.data.sha256}`);
  record.lines.forEach((line, index) => {
    lines.push('', `${index + 1}게임 · ${line.join(' ')}`);
    const info = research?.lines?.[index];
    const summary = gameNarration(line, info, { strategy: record.strategy, options: record.options,
      validation: research?.validation, comparable: record.comparable });
    if (!summary) { lines.push(MISSING_SELECTION); return; }
    lines.push(narrationTitle, summary);
    lines.push(`선택 조건 · ${conditions(info.selection, record.options)}`);
    for (const n of line) lines.push(`${n}번 · ${reasonFor(info.selection, n)}`);
    lines.push(`선택 후 조합 통계 · ${featuresText(info.features)}`);
  });
  lines.push('', ...validationText(research));
  if (!record.comparable || [research?.validation?.backtest, research?.validation?.monteCarlo].some(item =>
    item && (item.settings?.window || item.settings?.trainStart !== 1))) {
    lines.push('생성 방식이나 학습창이 달라 검정 성과는 전략 참고자료로 기록합니다.');
  }
  lines.push('공정한 추첨에서는 모든 6개 조합의 1등 확률이 1/8,145,060로 동일합니다.');
  return lines.join('\n');
}
