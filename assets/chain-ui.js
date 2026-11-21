import { createJobs } from './research-ui.js';
import { chainSettings, cleanChainRows, parseChain } from './chain-research.js';
import { researchDigest } from './research-provenance.js';

const $ = id => document.getElementById(id);
const lab = $('chains');
const jobs = createJobs('./chain-worker.js'), detailJobs = createJobs('./chain-worker.js'), matrixJobs = createJobs('./chain-worker.js');
const percent = value => value === null || value === undefined ? '검증 대기' : `${(value * 100).toFixed(2)}%`;
const decimal = value => value === null || value === undefined ? '검증 대기' : value.toFixed(4);
const pText = value => value === null || value === undefined ? '검증 대기' : value < .0001 ? value.toExponential(2) : value.toFixed(4);
const chainName = chain => chain.stages.map((stage, i) => `${stage.join('+')}${i < chain.gaps.length ? ` →(${chain.gaps[i]}회) ` : ''}`).join('');
let rows = [], fingerprint = '', generation = 0, analysis = null, validation = null, matrix = null, selected = [5, 12], busy = false;

function settings() {
  return chainSettings({ developmentEnd: +$('chainDevelopment').value, endRound: +$('chainEnd').value,
    maxLength: +$('chainLength').value, gap: +$('chainGap').value, minSupport: +$('chainSupport').value,
    topK: +$('chainTopK').value, seed: +$('chainSeed').value, mode: $('chainMode').value });
}
function status(message, error = false) {
  $('chainStatus').textContent = message;
  $('chainStatus').classList.toggle('chain-error', error);
}
function controls(running) {
  busy = running;
  $('chainRun').disabled = running || !rows.length;
  $('chainValidate').disabled = running || !analysis?.patterns.length;
  $('chainCancel').disabled = !running;
  $('chainExport').disabled = running || !analysis;
}
function cancelAll(message) {
  jobs.cancel(); detailJobs.cancel(); matrixJobs.cancel();
  controls(false);
  if (message) status(message);
}
function failure(error) { controls(false); status(error, true); }
function start(kind, payload, done) {
  controls(true);
  $('chainProgress').value = 0;
  jobs.start(kind, `${fingerprint}:${kind}:${JSON.stringify(payload.settings || payload.analysis?.settings)}:${payload.repetitions || ''}`,
    { rows, ...payload }, { update: fraction => { $('chainProgress').value = fraction; }, complete: result => {
      controls(false); $('chainProgress').value = 1; done(result); controls(false);
    }, fail: failure });
}
function renderAnalysis() {
  const { discovery, patterns, forecast, data } = analysis;
  $('chainScope').textContent = `자료 ${data.from}~${data.to}회 · ${data.draws}회(구간 내 누락 ${data.missing}회, 이후 자료 대기 ${data.pending}회) · 발견 1~${analysis.settings.developmentEnd}회 / 평가 ${analysis.settings.developmentEnd + 1}~${analysis.settings.endRound}회 · 본번호만 사용 · ${(analysis.durationMs / 1000).toFixed(2)}초`;
  $('chainSearchNote').textContent = `${discovery.visited.toLocaleString()}개 관측 노드 검사 · ${discovery.pruned.toLocaleString()}개 표본 가지치기 · ${discovery.deepest}단계까지 진행. ${discovery.reason}`;
  $('chainPatterns').innerHTML = patterns.length ? `<div class="tablewrap"><table class="datatable"><thead><tr><th>발견 구간에서 고정한 연쇄</th><th>발견 횟수 / 기대</th><th>평가 성공 / 조건 발생</th><th>조건부 확률 / 차이(%p)</th><th>95% 구간</th><th>평가 p(Holm)</th><th>MC 전체 후보 p</th><th>판단</th></tr></thead><tbody>${patterns.map((p, i) => {
    const e = p.evaluation, mc = validation?.patterns.find(item => item.id === p.chain.id);
    return `<tr><td><button class="btn tinybtn chain-pattern" data-index="${i}">${chainName(p.chain)}</button></td><td>${p.discovery.successes} / ${p.discovery.expected.toFixed(2)}</td><td>${e.successes} / ${e.trials}</td><td>${percent(e.probability)} / ${percent(e.effect)}</td><td>${percent(e.interval[0])}~${percent(e.interval[1])}</td><td>${pText(e.adjustedP)}</td><td>${pText(mc?.familyP)}</td><td>${mc?.verdict || p.verdict}</td></tr>`;
  }).join('')}</tbody></table></div>` : '<p>최소 표본 조건을 만족하는 양의 편차 후보가 없습니다. 결과를 임의로 만들지 않습니다.</p>';
  $('chainPatterns').querySelectorAll('.chain-pattern').forEach(button => button.addEventListener('click', () => {
    const pattern = patterns[+button.dataset.index];
    requestDetail(pattern.chain, pattern);
  }));
  const interval = forecast.interval ? `${decimal(forecast.interval[0])}~${decimal(forecast.interval[1])}` : '표본 부족';
  $('chainForecast').innerHTML = `<p class="chain-verdict">${forecast.verdict}</p><div class="tablewrap"><table class="datatable"><thead><tr><th>평가 방식</th><th>회차 / 게임(각각)</th><th>연쇄 실험 평균 적중</th><th>기존 균등 무작위 평균</th><th>회차 대응 차이</th><th>차이 95% 근사 구간</th><th>두 방식 보정 p</th></tr></thead><tbody><tr><td>${forecast.mode === 'fixed' ? '발견 후보 고정' : '50회마다 과거만 재학습'}</td><td>${forecast.n} / ${forecast.games}</td><td>${decimal(forecast.experimentalMean)}</td><td>${decimal(forecast.baselineMean)}</td><td>${decimal(forecast.difference)}</td><td>${interval}</td><td>${pText(forecast.adjustedP)}</td></tr></tbody></table></div><p class="research-help">활성 연쇄가 있었던 회차 ${forecast.activeRounds}회 · 누락/50회 연속 과거 부족 제외 ${forecast.skipped}회. 각 회차 5게임, 다섯 번째 공통 무작위 게임 유지. 회차 단위 정확한 6/45 조건부 검정과 ${forecast.intervalMethod}. 이론 평균은 게임당 0.8개입니다. 기존 9개 전략에는 반영되지 않습니다.</p><div class="chain-timeline">${forecast.rounds.map(r => `<span title="${r.round}회: 실험 ${r.experimentalHits}/기준 ${r.baselineHits}, 직전 자료 ${r.priorEnd}회" style="--chain-color:${r.difference > 0 ? '#52ddb0' : r.difference < 0 ? '#e9a96a' : '#506077'};--chain-height:${6 + Math.abs(r.difference) * 15}px"></span>`).join('')}</div><p class="research-help">평가 회차별 평균 적중 차이: 초록은 실험이 높음, 주황은 기준선이 높음. 모든 평가 회차를 유지합니다.</p>`;
  $('chainSource').textContent = `재현 시드 ${analysis.settings.seed} · 자료 SHA-256 ${analysis.source.sha256} · 계산 버전 ${analysis.version}`;
  $('chainForecast').insertAdjacentHTML('beforeend', `<div class="tablewrap"><table class="datatable"><caption>일치 번호별 게임 수 (평가 회차와 게임 수 동일)</caption><thead><tr><th>구분</th>${[3, 4, 5, 6].map(hits => `<th>${hits}개 적중</th>`).join('')}</tr></thead><tbody>${['experimental', 'baseline'].map(key => `<tr><td>${key === 'experimental' ? '연쇄 실험' : '균등 무작위'}</td>${[3, 4, 5, 6].map(hits => `<td>${forecast.frequency[key][hits]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
}

function requestDetail(chain, frozen = null) {
  let s;
  try { s = analysis?.settings || settings(); } catch (e) { failure(e.message); return; }
  $('chainDetail').textContent = '개별 연쇄 계산 중…';
  detailJobs.start('chain-detail', `${fingerprint}:${chain.id}:${JSON.stringify(s)}`, { rows, stages: chain.stages, gaps: chain.gaps, settings: s }, {
    update: () => {}, fail: error => status(error, true), complete: result => renderDetail(result, frozen),
  });
}
function renderDetail(result, frozen) {
  const d = result.discovery, e = result.evaluation, c = result.chain;
  const all = [...d.occurrences, ...e.occurrences];
  $('chainDetail').innerHTML = `<h3>${chainName(c)}</h3><p>${frozen ? '발견 구간에서 선택·고정한 후보입니다.' : '사용자가 선택한 탐색용 관계입니다. 평가 결과를 보고 고른 관계의 유의성을 확정하지 않습니다.'}</p><p>무작위 전체 연쇄 확률 ${percent(c.jointProbability)}, 마지막 단계 기준 확률 ${percent(c.nullProbability)}. 발견 ${d.successes}회(기대 ${d.expected.toFixed(2)}) / 평가 ${e.successes}회(기대 ${e.expected.toFixed(2)}).</p><p>평가 조건 발생 ${e.trials}회 · 조건부 출현 ${percent(e.probability)} · 기준 대비 ${percent(e.effect)} · 95% 조건부 구간 ${percent(e.interval[0])}~${percent(e.interval[1])}. ${e.trials < 20 ? '표본 부족: 반복이 적어 재현 여부를 판단할 수 없습니다.' : '구간은 일정한 조건부 확률을 가정한 보수적인 순차 구간입니다.'}</p><div class="chain-periods">${[...result.periods, { from: analysis?.settings.developmentEnd + 1 || settings().developmentEnd + 1, to: analysis?.settings.endRound || settings().endRound, ...e }].map(p => `<div><span>${p.from}~${p.to}회</span><strong>${p.successes}/${p.trials}</strong><meter min="0" max="1" value="${p.probability || 0}"></meter><span>${percent(p.probability)}</span></div>`).join('')}</div><p class="research-help">구간별 성공/조건 발생. 구간 경계의 앞선 회차도 이미 알려진 조건 자료로 사용합니다.</p><details><summary>발생 회차 ${all.length}건과 당시 이후 결과</summary><div class="tablewrap chain-occurrences"><table class="datatable"><thead><tr><th>연쇄 회차</th><th>구간</th><th>${c.gaps.at(-1)}회 후 본번호</th></tr></thead><tbody>${all.map(o => {
    const following = rows.find(row => row.round === o.end + c.gaps.at(-1));
    return `<tr><td>${o.rounds.join(' → ')}</td><td>${o.end <= (analysis?.settings || settings()).developmentEnd ? '발견' : '평가'}</td><td>${following && following.round <= (analysis?.settings || settings()).endRound ? following.numbers.join(', ') : '자료 없음/결과 대기'}</td></tr>`;
  }).join('')}</tbody></table></div></details><details><summary>전체 연쇄 이후 다음 번호 분포</summary>${[d, e].map((observation, i) => `<p>${i ? '평가' : '발견'}: 다음 결과 확인 ${observation.next.trials}회 · 다음 간격 ${observation.next.gap}회. 무작위 각 번호 기대 ${ (observation.next.trials * 6 / 45).toFixed(2)}회.</p><div class="chain-number-grid">${observation.next.counts.map((count, i) => `<span>${i + 1}<strong>${count}회</strong><small>${observation.next.trials ? percent(count / observation.next.trials) : '검증 대기'}</small></span>`).join('')}</div>`).join('')}<p class="research-help">연쇄의 마지막 번호 조건과, 전체 연쇄 이후의 분포는 별개입니다. 45개 번호 중 높은 값만 골라 예측력으로 해석하지 않습니다.</p></details>`;
  renderOccurrenceTimeline(all, c);
}

function renderOccurrenceTimeline(observations, chain) {
  const scope = analysis?.settings || settings();
  const line = document.createElement('div');
  line.className = 'chain-eventline';
  line.setAttribute('role', 'img');
  line.setAttribute('aria-label', `${chainName(chain)} 발생 위치. ${scope.developmentEnd}회에서 발견/평가 구간을 구분합니다.`);
  line.innerHTML = `<i class="chain-boundary" style="left:${scope.developmentEnd / scope.endRound * 100}%" title="발견 구간 끝 ${scope.developmentEnd}회"></i>${observations.map(o => `<span style="left:${o.end / scope.endRound * 100}%;background:${o.end <= scope.developmentEnd ? '#70b5ee' : '#52ddb0'}" title="${o.rounds.join(' → ')}회"></span>`).join('')}<small>1회 → ${scope.endRound}회 · 파랑: 발견, 초록: 평가 · 세로선: 구간 분리</small>`;
  $('chainDetail').querySelector('.chain-periods').before(line);
}

function renderMatrix() {
  const canvas = $('chainHeatmap'), ctx = canvas.getContext('2d'), cell = 10, margin = 32;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0d1727'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let a = 0; a < 45; a++) for (let b = 0; b < 45; b++) {
    const effect = matrix.trials[a] ? matrix.counts[a * 45 + b] / matrix.trials[a] - 6 / 45 : 0;
    const strength = Math.min(1, Math.abs(effect) / .15);
    ctx.fillStyle = effect > 0 ? `rgb(${35 + strength * 30},${65 + strength * 155},${65 + strength * 95})` : `rgb(${55 + strength * 170},${55 + strength * 80},${75 - strength * 20})`;
    ctx.fillRect(margin + b * cell, margin + a * cell, cell - 1, cell - 1);
  }
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#ccdbed';
  for (const n of [1, 5, 10, 15, 20, 25, 30, 35, 40, 45]) {
    ctx.fillText(n, margin + (n - 1) * cell - 2, 24); ctx.fillText(n, 8, margin + n * cell - 2);
  }
  ctx.strokeStyle = '#fff'; ctx.strokeRect(margin + (selected[1] - 1) * cell - 1, margin + (selected[0] - 1) * cell - 1, cell, cell);
  const n = matrix.trials[selected[0] - 1], count = matrix.counts[(selected[0] - 1) * 45 + selected[1] - 1];
  $('chainMatrixNote').textContent = `목표 ${matrix.from}~${matrix.to}회 · ${matrix.lag}회 간격 · 유효 창 ${matrix.windows}개. ${selected[0]} → ${selected[1]}: ${count}/${n}, 조건부 ${n ? percent(count / n) : '검증 대기'}, 기준 13.33%. 전체 연쇄 기대 ${matrix.expectedJoint.toFixed(2)}회. 구간 경계의 이미 알려진 과거 조건을 포함합니다. 초록=기준보다 높음, 주황=낮음. 색은 통계적 유의성을 뜻하지 않습니다.`;
}
function loadMatrix() {
  if (!rows.length) return;
  try {
    const s = settings(), evaluation = $('chainMatrixPeriod').value === 'evaluation';
    const job = { rows, lag: +$('chainLag').value, from: evaluation ? s.developmentEnd + 1 : 1, to: evaluation ? s.endRound : s.developmentEnd };
    matrixJobs.start('chain-matrix', `${fingerprint}:${job.lag}:${job.from}:${job.to}`, job, {
      update: () => {}, fail: error => status(error, true), complete: result => { matrix = result; renderMatrix(); },
    });
  } catch (error) { failure(error.message); }
}

if (lab) {
  for (const id of ['chainA', 'chainB']) for (let n = 1; n <= 45; n++) $(id).add(new Option(`${n}번`, n));
  $('chainA').value = selected[0]; $('chainB').value = selected[1];
  $('chainRun').addEventListener('click', () => {
    try {
      const s = settings(); validation = null; analysis = null;
      status('발견 구간에서 후보 탐색 후 독립 평가 중…');
      $('chainPatterns').textContent = '분석 중…'; $('chainForecast').textContent = ''; $('chainMC').textContent = '몬테카를로 미실행';
      start('chains', { settings: s }, result => {
        analysis = result; renderAnalysis(); status('분석 완료. 연쇄 재현 검정은 몬테카를로 검증 버튼으로 실행할 수 있습니다.');
      });
    } catch (error) { failure(error.message); }
  });
  $('chainValidate').addEventListener('click', () => {
    if (!analysis) return;
    status('발견 후보를 고정하고 무작위 평가 구간을 반복 생성 중…');
    start('chain-simulation', { analysis, repetitions: +$('chainRepeats').value }, result => {
      validation = result; renderAnalysis();
      $('chainMC').innerHTML = `<p>${result.method || result.reason} · ${(result.repetitions || 0).toLocaleString()}회 · ${(result.durationMs / 1000).toFixed(2)}초. ${result.patterns.filter(p => p.verdict.startsWith('검증 통과')).length}개 통과. 표본 20회 미만은 통과 판정을 하지 않습니다.</p><details><summary>몬테카를로 95% 기준 구간과 보정 결과</summary><div class="tablewrap"><table class="datatable"><thead><tr><th>연쇄</th><th>무작위 조건부 비율 95% 구간</th><th>조건 발생이 있었던 반복</th><th>경험적 p</th><th>Holm p</th><th>전체 후보 최댓값 p</th></tr></thead><tbody>${result.patterns.map(p => `<tr><td>${p.id}</td><td>${p.rateRange ? p.rateRange.map(percent).join('~') : '검증 대기'}</td><td>${p.rateSamples}/${result.repetitions}</td><td>${pText(p.pValue)}</td><td>${pText(p.adjustedP)}</td><td>${pText(p.familyP)}</td></tr>`).join('')}</tbody></table></div><p>조건부 비율 구간은 조건 발생이 1회 이상인 반복에 한정한 기술적 분포입니다. 가설 검정에는 조건 발생이 0회인 반복도 모두 포함합니다. 반복 수·시드·전체 후보군은 고정되며, 발견 단계는 독립 평가와 분리되어 있어 평가 구간만 재생성합니다.</p></details>`;
      status('몬테카를로 검증 완료. 통계적 연쇄와 미래 예측력 개선은 별도로 해석해 주세요.');
    });
  });
  $('chainCancel').addEventListener('click', () => cancelAll('계산을 취소했습니다. 미완료 결과는 저장하지 않았습니다.'));
  $('chainQueryRun').addEventListener('click', () => {
    try { requestDetail(parseChain($('chainQuery').value, +$('chainGap').value, $('chainQueryGaps').value)); }
    catch (error) { status(error.message, true); }
  });
  $('chainMatrixSelect').addEventListener('click', () => {
    selected = [+$('chainA').value, +$('chainB').value];
    if (matrix) renderMatrix();
    requestDetail(parseChain(`${selected[0]} / ${selected[1]}`, +$('chainLag').value));
  });
  $('chainHeatmap').addEventListener('click', event => {
    if (!matrix) return;
    const rect = event.currentTarget.getBoundingClientRect(), scale = 492 / rect.width;
    const b = Math.floor(((event.clientX - rect.left) * scale - 32) / 10) + 1;
    const a = Math.floor(((event.clientY - rect.top) * scale - 32) / 10) + 1;
    if (a < 1 || a > 45 || b < 1 || b > 45) return;
    $('chainA').value = a; $('chainB').value = b; $('chainMatrixSelect').click();
  });
  for (const id of ['chainLag', 'chainMatrixPeriod']) $(id).addEventListener('change', loadMatrix);
  lab.querySelectorAll('[data-chain-setting]').forEach(control => control.addEventListener('change', () => {
    cancelAll(); analysis = null; validation = null; controls(false);
    $('chainPatterns').textContent = '설정 변경: 새 분석을 실행해 주세요.';
    $('chainForecast').textContent = ''; $('chainDetail').textContent = '연쇄 후보를 선택해 주세요.';
    $('chainScope').textContent = ''; $('chainSource').textContent = ''; $('chainSearchNote').textContent = ''; $('chainMC').textContent = '몬테카를로 미실행';
    status('설정이 변경되었습니다. 이전 설정의 결과는 평가에 섞지 않습니다.'); loadMatrix();
  }));
  $('chainExport').addEventListener('click', () => {
    if (!analysis || busy) return;
    const blob = new Blob([JSON.stringify({ analysis, validation, warning: '역사적 분리 평가 · 기존 추천에 반영하지 않는 독립 연구' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `lotto-chain-${analysis.data.to}-${analysis.settings.seed}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  async function receiveData(input) {
    const current = ++generation;
    cancelAll(); rows = []; analysis = null; validation = null; matrix = null; controls(false);
    $('chainHeatmap').getContext('2d').clearRect(0, 0, 492, 492);
    $('chainMatrixNote').textContent = ''; $('chainPatterns').textContent = '자료 검증 중…';
    $('chainScope').textContent = ''; $('chainForecast').textContent = ''; $('chainDetail').textContent = '';
    $('chainMC').textContent = '몬테카를로 미실행'; $('chainSource').textContent = ''; $('chainSearchNote').textContent = '';
    try {
      const valid = cleanChainRows(input), digest = await researchDigest(valid);
      if (current !== generation) return;
      rows = valid; fingerprint = digest;
      $('chainEnd').value = rows.at(-1).round;
      $('chainDevelopment').value = Math.min(1000, rows.at(-1).round - 1);
      $('chainScope').textContent = `확정 본번호 ${rows.length}회를 불러왔습니다.`;
      $('chainPatterns').textContent = '발견 구간에서만 후보를 선택하려면 분석 시작을 누르세요.';
      $('chainForecast').textContent = ''; $('chainDetail').textContent = '연쇄 후보나 히트맵 관계를 선택해 주세요.';
      $('chainMC').textContent = '몬테카를로 미실행'; $('chainSource').textContent = ''; $('chainSearchNote').textContent = '';
      controls(false); status('자료 준비 완료. 고비용 분석은 버튼을 누를 때만 실행합니다.'); loadMatrix();
    } catch (error) { if (current === generation) failure(error.message); }
  }
  window.addEventListener('lotto-draws-changed', event => receiveData(event.detail));
  if (window.lottoResearchDraws?.length) receiveData(window.lottoResearchDraws);
}
