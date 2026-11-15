import { featuresText, reasonFor, referenceFor } from './selection-evidence.js';
import { STRATEGIES } from './lotto-strategies.js';
import { describeRecommendation, MISSING_SELECTION } from './recommendation-narration.js';

const names = new Map(STRATEGIES);
const overviewTitle = '추천 전략 및 공통 검증 요약';
const sanitize = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const kst = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));

function conditions(selection, options) {
  return [
    options?.uniqueLines && '동일 6개 조합 제외',
    options?.spread && '게임 간 번호 중복 금지',
    selection?.disjoint && !options?.spread && '전략 배치 안에서 선택된 번호 제외',
    selection?.method === 'pattern' && '홀짝 3:3 · 합계 100~149 · 연속 1쌍 이상 · 동일 조합 제외',
    selection?.shared && '공통 무작위 게임',
  ].filter(Boolean).join(' · ') || '게임 내 6개 번호 비복원 선택';
}

function hasDetails(game) {
  return Array.isArray(game?.reference) && Array.isArray(game.features?.bands) &&
    Array.isArray(game.features?.runs) && game.features.runs.every(Array.isArray);
}

function evidenceHTML(line, evidence, game, options) {
  return '<details class="research-method recommendation-detail"><summary>자세한 선정 근거 보기</summary>' +
    `<p class="research-help">선택 조건 · ${sanitize(conditions(game.selection, options))}</p>` +
    '<div class="tablewrap research-table" tabindex="0" aria-label="번호별 선정 근거"><table class="datatable"><thead>' +
    '<tr><th>번호</th><th>실제 선정 근거</th><th>참고 통계</th></tr></thead><tbody>' +
    line.map(number => `<tr><td>${number}</td><td>${sanitize(reasonFor(game.selection, number))}</td>` +
      `<td>${sanitize(referenceFor(evidence, game.reference.find(row => row?.number === number)))}</td></tr>`).join('') +
    `</tbody></table></div><p class="research-help">선택 후 조합 통계 · ${sanitize(featuresText(game.features))}</p></details>`;
}

export function recommendationHTML(record, scoreLabels = []) {
  const { common, games } = describeRecommendation(record);
  const missing = `<p class="research-help">${MISSING_SELECTION}</p>`;
  const overview = common.length ? `<section class="recommendation-overview"><h3>${overviewTitle}</h3>` +
    common.map(text => `<p>${sanitize(text)}</p>`).join('') + '</section>' : missing;
  return overview + record.lines.map((line, index) => {
    const game = games[index];
    const info = record.research?.lines?.[index];
    return `<section class="recommendation-game"><h3>${sanitize(game?.title ?? `${index + 1}게임`)}</h3>` +
      `<div class="live-game"><span>${sanitize(line.join(' · '))}</span>${scoreLabels[index] ? `<span>${sanitize(scoreLabels[index])}</span>` : ''}</div>` +
      (game ? `<div class="recommendation-narration"><p>${sanitize(game.selection)}</p><p>${sanitize(game.observed)}</p></div>` : common.length ? missing : '') +
      (game && hasDetails(info) ? evidenceHTML(line, record.research, info, record.options) : '') + '</section>';
  }).join('');
}

export function recommendationReport(record) {
  const { research } = record;
  const { common, games } = describeRecommendation(record);
  const lines = [`${record.round}회 추천 보고서 · ${names.get(record.strategy)} v${record.version}`,
    `생성 ${kst(record.generatedAtUTC)} KST · 기준 ${record.dataRound}회 · 시드 ${record.seed}`];
  if (research?.data) lines.push(`데이터 ${research.data.first}~${research.data.last}회 · SHA-256 ${research.data.sha256}`);
  lines.push('', ...(common.length ? [overviewTitle, ...common] : [MISSING_SELECTION]));
  record.lines.forEach((line, index) => {
    const game = games[index];
    const info = research?.lines?.[index];
    lines.push('', game?.title ?? `${index + 1}게임`, line.join(' '));
    if (!game) {
      if (common.length) lines.push(MISSING_SELECTION);
      return;
    }
    lines.push(game.selection, game.observed);
    if (!hasDetails(info)) return;
    lines.push(`선택 조건 · ${conditions(info.selection, record.options)}`);
    for (const n of line) lines.push(`${n}번 · ${reasonFor(info.selection, n)}`);
    lines.push(`선택 후 조합 통계 · ${featuresText(info.features)}`);
  });
  return lines.join('\n');
}
