import { getAutoChainService } from './chain-auto-service.js';
import { chainRecommendationRecord } from './chain-auto-record.js';
import { chainRecommendationHTML } from './chain-auto-report.js';
import { AUTO_CHAIN_ID, contextName } from './chain-auto.js';

const service = getAutoChainService(), mounts = [...document.querySelectorAll('[data-auto-chain]')];
const safe = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fixed = n => Number.isFinite(n) ? n.toFixed(4) : '검증 대기';
let rows = window.lottoResearchDraws || [], rendered = null, selectedMode = 'evidence';

function download(record) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `lotto-auto-chain-${record.data.last}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function render(state) {
  for (const mount of mounts) {
    let status = mount.querySelector('[data-auto-status]');
    if (!status) {
      mount.innerHTML = '<h2>자동 연쇄 분석 → 다음 회차 실험 추천</h2><p data-auto-status role="status" aria-live="polite"></p><progress data-auto-progress max="1" value="0" aria-label="자동 연쇄 분석 진행률"></progress><div data-auto-result></div>';
      status = mount.querySelector('[data-auto-status]');
    }
    status.textContent = state.phase === 'loading' ? '최신 확정 자료와 저장된 자동 분석을 확인하고 있습니다.' :
      state.phase === 'running' ? `전체 이력 자동 분석·회차별 워크포워드 평가 중 · ${Math.floor(state.progress * 100)}%` :
      state.phase === 'ready' ? `${state.record.data.first}~${state.record.data.last}회 → ${state.record.result.model.target}회 · ${state.source === 'server' ? '자동 갱신 저장본' : state.source === 'cache' ? '자료가 일치하는 저장본' : state.source === 'fallback' ? '점수 분석 실패 · 별도 대조군만 사용 가능' : '자동 분석 완료'}${state.warning ? ' · ' + state.warning : ''}` : state.warning || '확정 자료 대기';
    mount.querySelector('[data-auto-progress]').value = state.progress;
    mount.querySelector('[data-auto-progress]').hidden = !['loading', 'running'].includes(state.phase);
    const output = mount.querySelector('[data-auto-result]');
    if (!state.record) {
      if (state.phase !== 'running') output.innerHTML = state.phase === 'cancelled' ? '<button class="btn" data-auto-retry>자동 분석 다시 시작</button>' : '';
      continue;
    }
    if (rendered === state.record && output.children.length) continue;
    const r = state.record.result, v = r.validation, mode = r.recommendation.unavailable ? 'control' : selectedMode;
    const upcoming = chainRecommendationRecord(state.record, mode);
    const stale = Date.now() >= Date.parse(r.recommendation.cutoffUTC);
    const sourceMode = r.recommendation.unavailable ? '점수 기반 추천을 제공하지 못했습니다. 아래 무작위 대조군은 분석 추천과 별개입니다.' :
      `${r.search.registered.toLocaleString()}개 조건을 추적해 45개 번호 전부를 점수화했습니다. 5게임의 30개 위치 모두 순위와 분산 감점으로 선정하며 무작위 번호를 섞지 않습니다.`;
    output.innerHTML = `<p class="research-help">${safe(sourceMode)}</p>${stale ? '<p class="notice">대상 회차의 생성 마감이 지났습니다. 이 번호는 지난 자료 기준 연구 기록이며 최신 확정 결과 갱신을 기다립니다.</p>' : ''}
      <p class="auto-validation">${safe(v.status)} · 과거 순차 평가 ${v.n}회 / 각 ${v.games}게임</p>
      <div class="tablewrap"><table class="datatable"><thead><tr><th>10번째 연쇄 실험 평균</th><th>기존 균등 무작위 평균</th><th>대응 차이</th><th>95% 근사 구간</th><th>회차 단위 p</th></tr></thead><tbody><tr><td>${fixed(v.experimentalMean)}</td><td>${fixed(v.baselineMean)}</td><td>${fixed(v.difference)}</td><td>${v.interval ? v.interval.map(fixed).join('~') : '표본 부족'}</td><td>${fixed(v.pValue)}</td></tr></tbody></table></div>
      <p class="research-help">평가 당시에는 직전 회차까지의 자료만 사용했습니다. 모든 평가 회차를 포함하며 단기 성적이나 높은 조건부 비율로 당첨 확률 우위를 주장하지 않습니다.</p>
      <label class="form-label">표시할 결과 <select data-auto-mode><option value="evidence" ${mode === 'evidence' ? 'selected' : ''} ${r.recommendation.unavailable ? 'disabled' : ''}>분석 점수 기반 실험 추천</option><option value="control" ${mode === 'control' ? 'selected' : ''}>별도 균등 무작위 대조군</option></select></label>
      <details data-score-table ${r.recommendation.unavailable ? 'hidden' : ''}><summary>45개 전체 분석 점수·순위·근거 수준</summary><div class="tablewrap"><table class="datatable"><thead><tr><th>번호</th><th>분석 점수</th><th>순위</th><th>집계 관계 수</th><th>근거 수준</th></tr></thead><tbody>${[...r.model.scores].sort((a,b)=>a.rank-b.rank).map(s=>`<tr><td>${s.number}</td><td>${s.score.toFixed(6)}</td><td>${s.rank}</td><td>${s.relationCount}</td><td>${safe(s.evidenceStatus)}</td></tr>`).join('')}</tbody></table></div><p>점수는 미래 당첨 확률이 아닙니다. 표본이 없으면 0점과 명시적 동점 규칙을 표시합니다.</p></details>
      <details class="auto-games" open><summary>${r.model.target}회 ${mode === 'evidence' ? '분석 점수 실험 추천' : '무작위 대조군'} 5게임 · 번호별 선정 기록</summary>${chainRecommendationHTML(upcoming)}</details>
      <details><summary>현재 추천에 사용한 역사적 패턴 ${r.model.candidates.length}개</summary><div class="tablewrap"><table class="datatable"><thead><tr><th>자동 발견 조건 → 번호</th><th>과거 출현/조건</th><th>조건부 비율</th><th>등록 후 평가</th><th>전체 보정 p</th><th>검증 상태</th></tr></thead><tbody>${r.model.candidates.map(p => `<tr><td>${safe(contextName(p.context))} → ${p.number}</td><td>${p.successes}/${p.trials}</td><td>${(p.conditionalRate * 100).toFixed(2)}%</td><td>${p.validation.successes}/${p.validation.trials}</td><td>${fixed(p.validation.adjustedP)}</td><td>${safe(p.validation.status)}</td></tr>`).join('')}</tbody></table></div><p class="research-help">후보 발견에 쓴 과거 횟수와, 후보 등록 후의 순차 검증은 별개입니다. 현재 조건이 성립하는 회차와 과거 발생 회차는 아래 JSON에 모두 보관합니다.</p></details>
      <p class="research-help">자료 SHA-256 ${safe(state.record.data.sha256)} · 계산 ${(r.durationMs / 1000).toFixed(2)}초 · 기존 구매·9개 전략의 사전 확정 기록과 별도 저장</p>
      ${Object.entries(r.search.limits).some(([key, value]) => key !== 'deepest' && value > 0) ? '<p class="notice">일부 후보는 계산 예산으로 제한했습니다. 제한 내역은 JSON의 search.limits에서 확인할 수 있습니다.</p>' : ''}
      <div class="chain-actions"><button class="btn" data-auto-generator>10번째 전략으로 조합 생성</button><button class="btn" data-auto-export>자동 분석 JSON 저장</button><button class="btn" data-auto-retry>자동 분석 다시 실행</button></div>`;
    output.querySelector('[data-auto-export]').addEventListener('click', () => download(state.record));
    output.querySelector('[data-auto-generator]').addEventListener('click', () => {
      document.querySelector('[data-tab="generator"]').click();
      const control = document.getElementById('manualStrategy'); control.value = AUTO_CHAIN_ID; control.dispatchEvent(new Event('change'));
      const modeControl = document.getElementById('manualChainMode'); modeControl.value = mode; modeControl.dispatchEvent(new Event('change'));
    });
  }
  rendered = state.record;
}
mounts.forEach(mount => mount.addEventListener('click', event => {
  if (event.target.closest('[data-auto-retry]')) service.load(rows, true);
}));
mounts.forEach(mount => mount.addEventListener('change', event => {
  if (event.target.matches('[data-auto-mode]')) { selectedMode = event.target.value; rendered = null; render(service.getState()); }
}));
service.subscribe(render);
window.addEventListener('lotto-draws-changed', event => { rows = event.detail; service.load(rows); });
if (rows.length) service.load(rows);
// Reuse the existing validated data updater; do not maintain a second archive.
setInterval(() => {
  if (!document.hidden) window.dispatchEvent(new Event('lotto-data-refresh-request'));
}, 300000);
