import { createJobs, studyForm } from './research-ui.js';
import { STRATEGIES } from './lotto-strategies.js';
import { importResearch } from './research-archive.js';
import { sealResearch } from './research-provenance.js';

const $ = id => document.getElementById(id);
const names = new Map(STRATEGIES);
const jobs = createJobs();
const fmt = number => number.toLocaleString('ko-KR');
const value = number => number == null ? '—' : number.toFixed(3);
const p = number => number == null ? '—' : number < .0001 ? number.toExponential(2) : number.toFixed(4);
const range = points => points.map(value).join('~');
const percent = number => `${(number * 100).toFixed(2)}%`;
let rows = window.lottoResearchDraws ?? [];
let revision = 0;
let result = null;
let saved = false;
let saving = false;
const strategyOptions = STRATEGIES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
$('mcStrategy').innerHTML = '<option value="all">전체 9개 전략</option>' + strategyOptions;

function status(message) {
  $('mcStatus').textContent = message;
  $('mcProgress').hidden = true;
  $('mcCancel').hidden = true;
  $('mcRun').disabled = false;
}

function updateScope() {
  const s = studyForm();
  const start = s.evalStart ?? ((s.developmentEnd ?? 1000) + 1);
  const last = rows.reduce((latest, row) => Math.max(latest, row.round), 0);
  $('mcScope').textContent = `다음 실험에 적용할 전략 검증 설정 · 평가 ${start}~${s.evalEnd ?? last}회 · ` +
    (s.window ? `학습창 ${s.window}회` : '확장 학습창');
}

function hitChart(data, row) {
  return '<div class="research-legend"><span><i></i>가상 실험</span><span><i class="expected"></i>이론 확률</span><span><i class="baseline"></i>관측 분포</span></div>' +
    '<div class="research-chart">' +
    row.frequencies.map((n, k) => {
      const sim = n / (data.games * data.repetitions);
      const theory = data.theory.frequencies[k];
      const observed = row.observedFrequencies[k] / data.games;
      return `<div class="research-row"><span>${k}개 적중</span><div class="research-track">` +
        `<span class="research-observed" style="width:${sim * 100}%"></span>` +
        `<span class="research-expected" style="left:${theory * 100}%"></span>` +
        `<span class="study-historical" style="left:${observed * 100}%"></span></div>` +
        `<span class="research-numbers">${percent(sim)} / ${percent(theory)} / ${percent(observed)}</span></div>`;
    }).join('') + '</div>';
}

function pairedChart(data, row) {
  const d = row.paired.distribution;
  const observed = row.totalHits - data.strategies[0].totalHits;
  const min = Math.min(0, observed, d[0][0]);
  const max = Math.max(0, observed, d.at(-1)[0]);
  const width = Math.max(1, max - min);
  const peak = Math.max(...d.map(([, count]) => count));
  const x = point => 20 + 560 * (point - min) / width;
  const points = d.map(([delta, count]) => `${x(delta).toFixed(2)},${(125 - 108 * count / peak).toFixed(2)}`).join(' ');
  const [lower, upper] = row.paired.interval.map(number => x(number * data.games));
  return `<svg class="live-graph" viewBox="0 0 600 145" role="img" aria-label="가상 무작위 대비 차이 분포와 관측값">` +
    `<rect x="${lower}" width="${Math.max(1, upper - lower)}" y="14" height="111" fill="#5379a633"/>` +
    `<line x1="20" x2="580" y1="125" y2="125" stroke="#567286"/><line x1="${x(0)}" x2="${x(0)}" y1="14" y2="125" stroke="#567286" stroke-dasharray="4 3"/>` +
    `<polyline fill="none" stroke="var(--mint)" stroke-width="2" points="${points}"/>` +
    `<line x1="${x(observed)}" x2="${x(observed)}" y1="10" y2="125" stroke="var(--gold)" stroke-width="2"/></svg>` +
    `<p class="research-help">관측 차이 ${value(row.observedDelta)}개 · 합성 95% 기준 ${range(row.paired.interval)}개 · ` +
    `게임당 차이 범위 ${value(min / data.games)}~${value(max / data.games)}개</p>`;
}

function stability(row) {
  return '<details class="research-method"><summary>반복 횟수에 따른 추정값</summary>' +
    '<div class="tablewrap research-table" tabindex="0" aria-label="시뮬레이션 추정값 안정성"><table class="datatable"><thead>' +
    '<tr><th>반복 수</th><th>무작위 대비 평균</th><th>경험적 p</th></tr></thead><tbody>' +
    row.checkpoints.map(point => `<tr><td>${fmt(point.repetitions)}</td><td>${value(point.deltaMean)}</td><td>${p(point.pValue)}</td></tr>`).join('') +
    '</tbody></table></div></details>';
}

function renderChart(data, id) {
  const row = data.strategies.find(item => item.id === id);
  $('mcCharts').innerHTML = '<h3>게임별 적중 분포</h3>' + hitChart(data, row) +
    '<h3>무작위 기준 대비 분포</h3>' + pairedChart(data, row) + stability(row);
}

function render(data) {
  $('mcOutput').innerHTML = '<div class="card"><div class="card-title"><h2>전략 실험 결과</h2></div>' +
    `<p class="research-help">${data.played[0]}~${data.played.at(-1)}회 중 ${fmt(data.played.length)}회 · ${fmt(data.games)}게임/전략 · 제외 ${data.exclusions.length}회 · 이론 총합 ${fmt(data.theory.total)}개 · 버전 ${data.modelVersion} · 데이터 ${data.data.sha256.slice(0, 12)}</p>` +
    '<div class="tablewrap research-table" tabindex="0" aria-label="몬테카를로 전략 비교"><table class="datatable"><thead>' +
    '<tr><th>전략</th><th>관측 평균 / 관측 95%</th><th>가상 평균 / 가상 95%</th><th>가상 최저·최고 / 표준편차</th>' +
    '<th>3개 이상</th><th>관측 무작위 대비</th><th>경험적 / Holm p</th><th>판정</th></tr></thead><tbody>' +
    data.strategies.map(row => {
      const sim = row.simulation;
      const verdict = row.id === 'random' ? '균등 무작위 기준' : row.adjusted === null ? '검증 불충분'
        : row.adjusted > .05 ? '우위 미입증' : '이 실험 설정에서 유의한 편차';
      return `<tr><td>${names.get(row.id)}</td><td>${value(row.observedMean)} / ${row.observedInterval ? range(row.observedInterval) : '—'}</td>` +
        `<td>${value(sim.mean)} / ${range(sim.interval)}</td><td>${range([sim.min, sim.max])} / ${value(sim.sd)}</td>` +
        `<td>${percent(row.rate3)}</td><td>${value(row.observedDelta)}</td><td>${p(row.pValue)} / ${p(row.adjusted)}</td><td>${verdict}</td></tr>`;
    }).join('') + '</tbody></table></div></div>' +
    '<div class="card"><div class="card-title"><h2>분포와 추정 안정성</h2><label class="research-period">전략 <select id="mcChartStrategy">' +
    data.strategies.map(row => `<option value="${row.id}">${names.get(row.id)}</option>`).join('') + '</select></label></div><div id="mcCharts"></div></div>';
  $('mcChartStrategy').value = data.strategies[1]?.id ?? 'random';
  renderChart(data, $('mcChartStrategy').value);
  $('mcChartStrategy').addEventListener('change', event => renderChart(data, event.target.value));
}

function start() {
  const seed = $('mcSeed').valueAsNumber;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) { status('0~4,294,967,295 사이 시드를 입력하세요.'); return; }
  const choice = $('mcStrategy').value;
  const settings = studyForm();
  const job = { rows, settings, seed, strategyIds: choice === 'all' ? [...names.keys()] : [choice],
    mode: $('mcMode').value, repetitions: Number($('mcReps').value) };
  const key = JSON.stringify([revision, settings, seed, choice, job.mode, job.repetitions]);
  result = null;
  saved = false;
  $('mcOutput').textContent = '';
  $('mcSave').disabled = true;
  $('mcRun').disabled = true;
  $('mcCancel').hidden = false;
  $('mcProgress').value = 0;
  $('mcProgress').hidden = false;
  $('mcStatus').textContent = '공정 추첨 실험을 계산하는 중…';
  jobs.start('strategy-simulation', key, job, {
    update: progress => {
      $('mcProgress').value = progress;
      $('mcStatus').textContent = `진행률 ${Math.floor(progress * 100)}%`;
    },
    fail: status,
    complete: data => {
      result = data;
      window.lottoMonteCarloResult = data;
      window.dispatchEvent(new Event('lotto-monte-carlo-result'));
      status(`${fmt(data.repetitions)}회 완료 · 시드 ${data.seed} · ${data.mode === 'adaptive' ? '가상 이력 순차 갱신' : '과거 조합 고정'}`);
      render(data);
      $('mcSave').disabled = saving;
    },
  });
}

$('mcRun').addEventListener('click', start);
$('mcCancel').addEventListener('click', () => { jobs.cancel(); status('실험을 취소했습니다.'); });
$('mcSave').addEventListener('click', async () => {
  if (!result || saved || saving) return;
  const captured = result;
  saving = true;
  $('mcSave').disabled = true;
  try {
    const record = await sealResearch({ id: crypto.randomUUID(), schema: 1, generatedAtUTC: captured.executedAtUTC, result: captured });
    await importResearch({ schema: 1, kind: 'experiments', records: [record] });
    if (result === captured) { saved = true; status('연구 아카이브에 저장했습니다.'); }
    window.dispatchEvent(new Event('lotto-research-saved'));
  } catch (error) { if (result === captured) status(`저장 실패 · ${error.message}`); }
  finally { saving = false; $('mcSave').disabled = !result || saved; }
});
document.querySelector('[data-tab="montecarlo"]').addEventListener('click', updateScope);
window.addEventListener('lotto-study-settings', updateScope);
window.addEventListener('lotto-draws-changed', event => {
  rows = event.detail;
  revision++;
  updateScope();
});
