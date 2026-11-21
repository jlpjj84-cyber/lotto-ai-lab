import { AUTO_CHAIN_NAME, contextName } from './chain-auto.js';
import { rankedNumberReason, rankedRecommendationHTML, rankedRecommendationReport } from './chain-ranked-report.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = n => `${(n * 100).toFixed(2)}%`;
const fixed = n => Number.isFinite(n) ? n.toFixed(4) : '검증 대기';
const stateText = validation => `${validation.status} · 순차 평가 ${validation.n}회/각 ${validation.games}게임 · 실험 ${fixed(validation.experimentalMean)}개 / 균등 무작위 ${fixed(validation.baselineMean)}개 · 차이 ${fixed(validation.difference)}개`;

export function chainNumberReason(record, game, number) {
  if (record.research?.model?.scores) return rankedNumberReason(record, game, number);
  const r = record.research, decision = r.trace[game].decisions.find(d => d.number === number);
  if (r.trace[game].method === 'uniform') return `${number}번은 ${decision.pool}개 남은 후보에서 동일한 가중치로 선택했습니다. 역사적 패턴은 이 게임의 번호 선택에 사용하지 않았습니다.`;
  const influences = decision.influences.map(id => r.model.candidates.find(p => p.id === id));
  return `${number}번: 추출 가중치 ${decision.weight.toFixed(4)}, 당시 후보 ${decision.pool}개. ` +
    (influences.length ? influences.map(p => `${contextName(p.context)} → ${number}번 (과거 ${p.successes}/${p.trials}, 최근 성공 회차 ${p.successfulTargets.slice(-4).join('·') || '없음'}, 추가 가중치 ${p.contribution.toFixed(4)}, ${p.validation.status})`).join('; ') :
      '이 번호에는 추가 패턴 가중치가 없으며 기본 가중치 1로 추출했습니다.');
}

export function chainRecommendationHTML(record, scoreLabels = []) {
  if (record.research?.model?.scores) return rankedRecommendationHTML(record, scoreLabels);
  const r = record.research;
  if (r?.kind !== 'auto-chain' || !Array.isArray(r.trace) || !r.model) return '<p class="research-help">생성 당시 확인 가능한 연쇄 선정 근거 없음</p>';
  const header = `<section class="recommendation-overview"><h3>추천 전략 및 공통 검증 요약</h3><p>10번째 · ${AUTO_CHAIN_NAME} v${escape(record.version)}. ${record.historyFirst}회부터 ${record.dataRound}회까지 보유한 과거 조건을 사용합니다.</p><p>${r.model.fallback ? escape(r.model.fallbackReason) : '현재 성립하는 역사적 조건에서 이후 번호가 출현한 비율로 각 5게임 묶음의 첫 4게임 추출 가중치를 조정했습니다. 가중치는 번호별 2를 상한으로 둡니다.'}</p><p>${escape(stateText(r.validation))}</p><p>검증된 우위가 없어도 사용할 수 있는 실험 추천입니다. 추출 가중치는 실제 로또 당첨 확률이 아닙니다. ${record.comparable ? '' : '게임 수·시드·중복 제한을 바꾸어 기존 평가와 직접 비교할 수 없습니다.'}</p><p>${record.source === 'manual' ? '사용자 생성 기록' : '자동 연구 기록'}이며 기존 9개 전략의 GitHub 사전 확정 성과에는 포함하지 않습니다.</p></section>`;
  return '<p class="notice">보존된 v5.2.1 가중 무작위 기록입니다. 현재 5.2.2 점수 순위 추천과 구분합니다.</p>' + header + record.lines.map((line, i) => {
    const trace = r.trace[i], title = trace.shared ? `${i + 1}게임 · 공통 무작위` : `${i + 1}게임 · ${trace.method === 'uniform' ? '균등 무작위 대체' : '연쇄 패턴 실험'}`;
    const involved = [...new Set(trace.decisions.flatMap(d => d.influences))];
    return `<section class="recommendation-game"><h3>${title}</h3><div class="live-game"><span>${line.join(' · ')}</span>${scoreLabels[i] ? `<span>${escape(scoreLabels[i])}</span>` : ''}</div><p class="recommendation-narration">${trace.method === 'uniform' ? '이 게임은 역사적 조건의 가중치를 사용하지 않고 균등 추출했습니다.' : `선택된 번호에 ${involved.length}개의 활성 패턴이 가중치로 반영되었습니다. 추가 가중치가 없는 번호도 선택할 수 있습니다.`}</p><details class="recommendation-detail"><summary>번호별 역사적 패턴과 검증 상태</summary><div class="tablewrap"><table class="datatable"><thead><tr><th>번호</th><th>실제 선택 과정과 근거</th></tr></thead><tbody>${line.map(n => `<tr><td>${n}</td><td class="auto-reason">${escape(chainNumberReason(record, i, n))}</td></tr>`).join('')}</tbody></table></div></details></section>`;
  }).join('');
}

export function chainRecommendationReport(record) {
  if (record.research?.model?.scores) return rankedRecommendationReport(record);
  const r = record.research;
  if (r?.kind !== 'auto-chain') return '생성 당시 확인 가능한 연쇄 선정 근거 없음';
  const text = [`${record.round}회 · 10번째 ${AUTO_CHAIN_NAME} v${record.version}`, `생성 ${record.generatedAtUTC} · 데이터 ${record.historyFirst}~${record.dataRound}회 · SHA-256 ${r.data.sha256}`,
    stateText(r.validation), '실험 추천이며 무작위보다 높은 당첨 확률을 보장하지 않습니다. 기존 9개 전략의 사전 확정 성과와 별개입니다.'];
  record.lines.forEach((line, i) => {
    text.push('', `${i + 1}게임${r.trace[i].shared ? ' · 공통 무작위' : ''}: ${line.join(' ')}`);
    line.forEach(n => text.push(chainNumberReason(record, i, n)));
  });
  return text.join('\n');
}
