import { DEFAULT_SEED } from './research-math.js';
import { GROUPS, THEORY, matchingRounds, observePatterns, referenceRange, selectWindow } from './research-patterns.js';
import { patternJob } from './research-simulation.js';
import { BASELINE_REPETITIONS, DEVELOPMENT_END, EXPECTED_MATCHES, GAMES_PER_DRAW } from './research-backtest.js';

const $ = id => document.getElementById(id);
const fmt = number => number.toLocaleString('ko-KR');
const pct = value => `${(value * 100).toFixed(2)}%`;
const signed = (number, digits = 2) => `${number > 0 ? '+' : ''}${number.toFixed(digits)}`;
const pv = value => value < .0001 ? value.toExponential(2) : value.toFixed(4);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function createJobs() {
  const cache = new Map();
  let worker = null;
  let active = null;

  function cancel() {
    if (!active) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
    active = null;
  }

  function receive({ data }) {
    if (!active) return;
    if (data.progress !== undefined) {
      active.update(data.progress);
      return;
    }
    const { key, complete, fail } = active;
    active = null;
    if (data.error) fail(data.error);
    else {
      if (cache.size >= 12) cache.delete(cache.keys().next().value);
      cache.set(key, data.result);
      complete(data.result);
    }
  }

  return { cancel, start(kind, key, job, { update, complete, fail }) {
    cancel();
    if (cache.has(key)) { complete(cache.get(key)); return; }
    try {
      if (!worker) {
        worker = new Worker(new URL('./research-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = receive;
      }
      active = { key, update, complete, fail };
      worker.onerror = () => { cancel(); fail('분석 파일을 불러오지 못했습니다. HTTP로 열린 페이지에서 새로고침해 주세요.'); };
      worker.postMessage({ kind, job });
    } catch {
      if (active) cancel();
      fail('이 환경에서 백그라운드 분석을 시작하지 못했습니다.');
    }
  } };
}

const simulations = createJobs();
const strategyJobs = createJobs();
let rows = [];
let signature = '';
let currentWindow;
let currentAnalysis;
let fullAnalysis;
let selection = [];
let selectedGroup = 'numbers';
let previousLatestRound;

function showDetail(target, analysis, row) {
  const matches = matchingRounds(analysis, row.criterion, row.value).reverse();
  const probability = row.n ? pct(matches.length / row.n) : '—';
  const range = referenceRange(row);
  target.hidden = false;
  target.innerHTML = `<p><strong>${escape(row.label)}</strong> · ${fmt(matches.length)} / ${fmt(row.n)}회 (${probability})` +
    ` · 이론 ${pct(row.p)} (${row.expected.toFixed(1)}회) · 편차 ${signed(matches.length - row.expected, 1)}회</p>` +
    (range ? `<p class="tiny">무작위 95% 기준 ${range[0]}~${range[1]}회 · ${analysis.first}~${analysis.last}회</p>` : '') +
    (matches.length ? `<details><summary>해당 회차 ${fmt(matches.length)}개 보기</summary>` +
      `<div class="research-rounds" tabindex="0" aria-label="조건에 해당하는 회차">${matches.map(draw => `${draw.round}회`).join(' · ')}</div></details>`
      : '<p class="tiny">이 범위에서 해당하는 회차가 없습니다.</p>');
}

function renderDraw() {
  const draw = fullAnalysis.analyzed.find(item => item.round === Number($('patternRound').value));
  if (!draw) return;
  const { feature: f } = draw;
  const n = fullAnalysis.n;
  const card = (label, description, p, criterion, value, detailLabel, count = n) =>
    ({ label, description, p, criterion, value, detailLabel: detailLabel ?? `${label} ${description}`, n: count, expected: count * p });
  selection = [
    card('홀짝', `${f.odd}:${6 - f.odd}`, THEORY.odd[f.odd], 'odd', f.odd),
    card('번호 합계', String(f.sum), THEORY.sums[f.sum], 'sumExact', f.sum),
    card('연속번호', f.runs.length ? f.runs.map(group => group.join('–')).join(' / ') : '없음',
      THEORY.runs[f.longest], 'run', f.longest, f.longest > 1 ? `최장 ${f.longest}개 연속` : '연속번호 없음'),
    card('같은 끝자리', f.sameEnds.length ? f.sameEnds.map(group => group.join('·')).join(' / ') : '없음',
      THEORY.ends[f.endMax], 'end', f.endMax, f.endMax > 1 ? `같은 끝자리 최대 ${f.endMax}개` : '같은 끝자리 없음'),
    f.repeated === null ? { label: '직전 회차 중복', description: '직전 회차 자료 없음', disabled: true }
      : card('직전 회차 중복', f.repeated.length ? f.repeated.join('·') : '없음',
        THEORY.overlap[f.repeated.length], 'overlap', f.repeated.length, `직전 회차와 ${f.repeated.length}개 중복`, fullAnalysis.comparable),
  ];
  $('patternDrawNumbers').textContent = `${draw.date} · ${draw.numbers.join(' · ')}`;
  $('patternCards').innerHTML = selection.map((item, i) => `<button type="button" class="research-chip" ` +
    `data-card="${i}" aria-pressed="false"${item.disabled ? ' disabled' : ''}><span>${item.label}</span>` +
    `<strong>${item.description}</strong></button>`).join('');
  $('patternDrawDetail').hidden = true;
}

function chart(entries) {
  const scale = Math.max(.001, ...entries.map(row => Math.max(row.observed / row.n, row.p, referenceRange(row)[1] / row.n)));
  return `<div class="research-chart">${entries.map((row, i) => {
    const [lower, upper] = referenceRange(row);
    const position = value => Math.min(100, value / scale * 100);
    return `<div class="research-row"><button type="button" data-event="${i}">${row.label}</button>` +
      `<div class="research-track" aria-hidden="true"><span class="research-band" style="left:${position(lower / row.n)}%;width:${position((upper - lower) / row.n)}%"></span>` +
      `<span class="research-observed" style="width:${position(row.observed / row.n)}%"></span>` +
      `<span class="research-expected" style="left:${position(row.p)}%"></span></div>` +
      `<div class="research-numbers">${fmt(row.observed)}회 · ${pct(row.observed / row.n)} / 기대 ${row.expected.toFixed(1)}회 · ${pct(row.p)} ` +
      `(${signed(row.delta, 1)}회)<br>95% 기준 ${lower}~${upper}회</div></div>`;
  }).join('')}</div>`;
}

function gapsTable(entries) {
  return `<div class="tablewrap research-table" tabindex="0" aria-label="최근 출현 간격"><table class="datatable">` +
    '<thead><tr><th>번호</th><th>마지막 관측</th><th>현재 미출현</th><th>이론 평균</th><th>편차</th><th>직전 출현 간격 · 편차</th></tr></thead><tbody>' +
    entries.map(row => `<tr><td>${row.number}번</td><td>${row.lastSeen ? `${row.lastSeen}회` : '구간 내 없음'}</td>` +
      `<td>${row.censored ? '최소 ' : ''}${row.observed}회</td><td>${row.expected.toFixed(1)}회</td>` +
      `<td>${row.censored ? '최소 ' : ''}${signed(row.delta, 1)}회</td>` +
      `<td>${row.lastInterval === null ? '—' : `${row.lastInterval}회 · ${signed(row.lastInterval - 7.5, 1)}회`}</td></tr>`).join('') +
    '</tbody></table></div><p class="research-help">현재 미출현은 마지막 등장 이후 연속으로 지나간 회차입니다. ' +
    '직전 출현 간격은 앞선 두 등장 사이의 거리이며 이론 평균은 7.5회입니다. 누락을 넘는 구간은 추정하지 않습니다.</p>';
}

let plotted = [];
function renderGroup() {
  selectedGroup = $('patternGroup').value;
  const isCombo = selectedGroup === 'pairs' || selectedGroup === 'triples';
  $('patternComboLabel').hidden = !isCombo;
  $('patternPeriodDetail').hidden = true;
  const source = currentAnalysis.groups[selectedGroup];
  if (selectedGroup === 'gaps') {
    plotted = [];
    $('patternChart').innerHTML = gapsTable(source);
    return;
  }
  const query = $('patternCombo').value.trim();
  if (isCombo && query) {
    const expected = selectedGroup === 'pairs' ? 2 : 3;
    const values = query.split(/[\s,·-]+/).filter(Boolean).map(Number).sort((a, b) => a - b);
    if (values.length !== expected || new Set(values).size !== expected ||
        !values.every(number => Number.isInteger(number) && number >= 1 && number <= 45)) {
      $('patternChart').textContent = `1~45 사이 서로 다른 번호 ${expected}개를 입력하세요.`;
      plotted = [];
      return;
    }
    plotted = source.filter(row => row.value.join(',') === values.join(','));
  } else plotted = isCombo ? source.slice(0, 12) : source;
  if (!plotted.length || !plotted[0].n) {
    $('patternChart').textContent = '이 항목을 비교할 연속 회차가 없습니다.';
    return;
  }
  const legend = '<div class="research-legend"><span><i></i>관측</span><span><i class="expected"></i>이론 기대</span>' +
    '<span><i class="band"></i>항목별 무작위 95% 기준</span></div>';
  const sumNote = selectedGroup === 'sum' ? `<p class="research-help">평균 합계 ${currentAnalysis.averageSum.toFixed(2)} · ` +
    `이론 평균 138 · 편차 ${signed(currentAnalysis.averageSum - 138)}</p>` : '';
  $('patternChart').innerHTML = legend + sumNote + chart(plotted) + (isCombo ?
    `<p class="research-help">전체 ${fmt(source.length)}개 조합을 계산합니다. ${query ? '검색한 조합을 표시합니다.' : '출현 횟수 상위 12개를 표시합니다.'} ` +
    '이 구간은 고정된 조합 하나의 기준이며, 최다 조합의 특이성은 아래 전체 최대 검정에서 비교합니다.</p>' : '');
}

function renderPeriod() {
  currentWindow = selectWindow(rows, $('patternRange').value);
  currentAnalysis = $('patternRange').value === 'all' ? fullAnalysis : observePatterns(currentWindow);
  $('patternScope').textContent = `${currentAnalysis.first}~${currentAnalysis.last}회 · ${fmt(currentAnalysis.n)}회 · ` +
    `직전 회차 비교 ${fmt(currentAnalysis.comparable)}쌍` + (currentAnalysis.missing ? ` · 누락 ${currentAnalysis.missing}회` : '');
  renderGroup();
  clearSimulation('선택 기간과 같은 길이의 무작위 추첨을 비교합니다.');
}

function clearSimulation(message) {
  simulations.cancel();
  $('patternRun').disabled = false;
  $('patternCancel').hidden = true;
  $('patternProgress').hidden = true;
  $('patternStatus').textContent = message;
  $('patternTests').innerHTML = '';
}

function testRows(result) {
  return `<div class="tablewrap research-table" tabindex="0" aria-label="통계적 특이성 결과"><table class="datatable"><thead>` +
    '<tr><th>패턴</th><th>관측 / 표본</th><th>기대 · 편차</th><th>무작위 95% 기준</th><th>경험적 p</th><th>보정 p</th><th>판정</th></tr>' +
    `</thead><tbody>${result.rows.map(row => {
      const expected = row.expected ?? row.simulatedMean;
      const outside = row.observed < row.range[0] || row.observed > row.range[1];
      const standard = result.seed === DEFAULT_SEED;
      const significant = standard && row.adjusted <= .05;
      const review = outside || row.pValue <= .05;
      const verdict = significant ? '통계적으로 유의한 편차' : review ? '추가 검증이 필요한 편차' : '일반적인 무작위 변동';
      const value = ['maxPair', 'maxTriple'].includes(row.id) ? ` · ${row.value.join('·')}` : '';
      return `<tr><td>${row.label}${value}</td><td>${fmt(row.observed)} / ${fmt(row.n)}</td>` +
        `<td>${expected.toFixed(2)} · ${signed(row.observed - expected)}</td><td>${row.range.join('~')}</td>` +
        `<td>${pv(row.pValue)}</td><td>${pv(row.adjusted)}</td>` +
        `<td class="research-verdict ${significant ? 'research-above' : review ? 'research-gap' : ''}">${verdict}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function startSimulation() {
  const input = $('patternSeed');
  const seed = input.valueAsNumber;
  if (!input.validity.valid || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    clearSimulation('시드는 0~4,294,967,295 사이의 정수를 입력하세요.');
    return;
  }
  const repetitions = Number($('patternRepetitions').value);
  const key = `${signature}:${$('patternRange').value}:${seed}:${repetitions}`;
  clearSimulation('무작위 추첨을 비교하는 중…');
  $('patternRun').disabled = true;
  $('patternCancel').hidden = false;
  $('patternProgress').value = 0;
  $('patternProgress').hidden = false;
  simulations.start('simulation', key, patternJob(currentWindow, currentAnalysis, repetitions, seed), {
    update: value => { $('patternProgress').value = value; $('patternStatus').textContent = `무작위 비교 ${Math.floor(value * 100)}%`; },
    complete: result => {
      clearSimulation(`${fmt(repetitions)}회 완료 · 시드 ${seed} · 매 반복 ${fmt(currentAnalysis.n)}회 추첨` +
        (seed === DEFAULT_SEED ? ' · 판정 기준 적용' : ' · 탐색용 시드'));
      $('patternTests').innerHTML = testRows(result);
    },
    fail: clearSimulation,
  });
}

const formatRange = values => values.length ? `${values[0]}~${values.at(-1)}회` : '자료 없음';
const mean = value => value === null ? '—' : value.toFixed(3);
const bounds = values => values ? values.map(value => value.toFixed(3)).join('~') : '—';

function strategyTable(result) {
  const evaluation = result.evaluation.length;
  if (!evaluation && !result.development.length) return '<p class="research-help">연속 50회 이력과 그 이후 추첨 결과가 필요합니다.</p>';
  return `<div class="tablewrap research-table" tabindex="0" aria-label="전략별 성과"><table class="datatable"><thead>` +
    '<tr><th>전략</th><th>평가 평균</th><th>기준선 차이</th><th>평가 회차 / 게임</th>' +
    '<th>95% 추정 구간</th><th>정확히 3 / 4 / 5 / 6개</th><th>모의 수익률</th><th>보정 p</th><th>개발 평균</th></tr></thead>' +
    `<tbody>${result.strategies.map(row => {
      const e = row.evaluation;
      const d = row.development;
      const delta = e.mean === null ? null : e.mean - EXPECTED_MATCHES;
      const roi = e.roi === null ? '—' : pct(e.roi);
      const payout = e.games ? `<details><summary>${roi}</summary><p>비용 ${fmt(e.spent)}원 · ` +
        `확인된 당첨금 ${fmt(e.prize)}원${e.unpriced ? ` · 당첨금 누락 ${e.unpriced}게임` : ''}</p></details>` : '—';
      return `<tr><td><strong>${row.label}</strong></td><td>${mean(e.mean)}</td>` +
        `<td class="${delta === null ? '' : delta < 0 ? 'research-below' : 'research-above'}">${delta === null ? '—' : signed(delta, 3)}</td>` +
        `<td>${fmt(e.draws)} / ${fmt(e.games)}</td><td>${bounds(e.interval)}</td>` +
        `<td>${e.games ? e.hits.slice(3).map(fmt).join(' / ') : '—'}</td><td>${payout}</td>` +
        `<td>${e.adjusted === null ? '—' : pv(e.adjusted)}</td><td>${mean(d.mean)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function startBacktest() {
  $('strategyRun').disabled = true;
  $('strategyStatus').textContent = '워크포워드 평가를 계산하는 중…';
  strategyJobs.start('backtest', signature, rows, {
    update: value => { $('strategyStatus').textContent = `과거 회차 순차 평가 ${Math.floor(value * 100)}%`; },
    complete: result => {
      $('strategyRun').disabled = false;
      $('strategyStatus').textContent = `개발 ${formatRange(result.development)} (${fmt(result.development.length)}회) · ` +
        `평가 ${formatRange(result.evaluation)} (${fmt(result.evaluation.length)}회) · 시드 ${result.seed}`;
      const candidates = result.strategies.filter(row => row.evaluation.adjusted !== null && row.evaluation.adjusted <= .05);
      $('strategyBaseline').textContent = result.baseline ?
        `무작위 기준 게임당 ${EXPECTED_MATCHES.toFixed(3)}개 · ${fmt(result.baseline.repetitions)}번 반복의 95% 범위 ` +
        `${bounds(result.baseline.interval)} · 정확히 3/4/5/6개 기대 횟수 ` +
        result.baseline.expectedHits.slice(3).map(value => value.toFixed(3)).join(' / ') +
        (candidates.length ? ` · 추가 미래 평가 후보 ${candidates.length}개` : ' · 기준선 대비 통계적 우위 확인 없음')
        : '고정 평가 구간의 결과가 쌓이면 기준선과 비교합니다.';
      $('strategyResults').innerHTML = strategyTable(result);
      window.lottoBacktestResult = result;
      window.dispatchEvent(new CustomEvent('lotto-backtest-result', { detail: result }));
    },
    fail: message => {
      $('strategyRun').disabled = false;
      $('strategyStatus').textContent = message;
      window.dispatchEvent(new CustomEvent('lotto-backtest-result', { detail: null }));
    },
  });
}

function updateDraws(draws) {
  if (!draws.length) return;
  const key = JSON.stringify(draws);
  if (key === signature) return;
  signature = key;
  rows = draws.slice().sort((a, b) => a.round - b.round);
  fullAnalysis = observePatterns(selectWindow(rows, 'all'));
  const selected = $('patternRound').value;
  $('patternRound').innerHTML = fullAnalysis.analyzed.slice().reverse().map(row =>
    `<option value="${row.round}">${row.round}회 · ${escape(row.date)}</option>`).join('');
  if (previousLatestRound && selected !== String(previousLatestRound) && rows.some(row => row.round === Number(selected))) {
    $('patternRound').value = selected;
  }
  previousLatestRound = rows.at(-1).round;
  renderDraw();
  renderPeriod();
  strategyJobs.cancel();
  window.lottoBacktestResult = null;
  window.dispatchEvent(new CustomEvent('lotto-backtest-result', { detail: null }));
  $('strategyRun').disabled = false;
  $('strategyResults').innerHTML = '';
  $('strategyBaseline').textContent = '';
  $('strategyStatus').textContent = `개발 구간 ${DEVELOPMENT_END}회까지 · 평가 ${DEVELOPMENT_END + 1}회부터 · 회차당 ${GAMES_PER_DRAW}게임`;
  if ($('backtest').classList.contains('active')) startBacktest();
}

$('patternGroup').innerHTML = GROUPS.map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
$('patternRound').addEventListener('change', renderDraw);
$('patternCards').addEventListener('click', event => {
  const button = event.target.closest('[data-card]');
  if (!button) return;
  $('patternCards').querySelectorAll('[data-card]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  const row = selection[Number(button.dataset.card)];
  showDetail($('patternDrawDetail'), fullAnalysis, { ...row, label: row.detailLabel });
});
$('patternRange').addEventListener('change', renderPeriod);
$('patternGroup').addEventListener('change', () => { $('patternCombo').value = ''; renderGroup(); });
$('patternCombo').addEventListener('input', renderGroup);
$('patternChart').addEventListener('click', event => {
  const button = event.target.closest('[data-event]');
  if (button) {
    showDetail($('patternPeriodDetail'), currentAnalysis, plotted[Number(button.dataset.event)]);
    $('patternPeriodDetail').scrollIntoView({ block: 'nearest' });
  }
});
$('patternRun').addEventListener('click', startSimulation);
$('patternCancel').addEventListener('click', () => clearSimulation('계산을 취소했습니다.'));
$('patternSeed').addEventListener('change', () => clearSimulation('시드가 바뀌었습니다. 다시 실행해 주세요.'));
$('patternRepetitions').addEventListener('change', () => clearSimulation('반복 횟수가 바뀌었습니다. 다시 실행해 주세요.'));
$('strategyRun').addEventListener('click', startBacktest);
document.querySelector('[data-tab="backtest"]').addEventListener('click', () => {
  if (!$('strategyResults').innerHTML && !$('strategyRun').disabled) startBacktest();
});
window.addEventListener('lotto-draws-changed', event => updateDraws(event.detail));
window.addEventListener('lotto-backtest-request', () => { if (!$('strategyRun').disabled) startBacktest(); });
if (window.lottoResearchDraws) updateDraws(window.lottoResearchDraws);
