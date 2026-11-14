import { STRATEGIES } from './lotto-strategies.js';
import { MIN_LIVE_ROUNDS } from './live-summary.js';
import { EPOCH, KST, scheduleFor, WEEK } from './lotto-calendar.js';

const $ = id => document.getElementById(id);
const names = new Map(STRATEGIES);
const fmt = value => value.toLocaleString('ko-KR');
const money = value => `${fmt(value)}원`;
const number = value => value == null ? '—' : value.toFixed(3);
const signed = value => value == null ? '—' : `${value > 0 ? '+' : ''}${number(value)}`;
const interval = value => value ? value.map(number).join(' ~ ') : '표본 부족';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kst = value => value && Number.isFinite(Date.parse(value))
  ? `${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))} KST` : '—';
const repoURL = 'https://github.com/jlpjj84-cyber/lotto-ai-lab';
const validRunLink = value => /^https:\/\/github\.com\/jlpjj84-cyber\/lotto-ai-lab\/actions\/runs\/[0-9]+$/.test(value || '');
const asLink = (url, label) => `<a href="${escape(url)}" target="_blank" rel="noopener">${label}</a>`;
const drawDate = round => scheduleFor(round).date;
let catalog;
let archived = new Map();
let backtest = window.lottoBacktestResult;
let aggregate;
let active = false;
let loaded = false;
let refreshId = 0;
let detailId = 0;
let request;
let details = new Map();

async function fetchJSON(path, signal) {
  const response = await fetch(new URL(`../data/live/${path}`, import.meta.url), { cache: 'no-cache', signal });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}

function targetRound(latest = catalog.latestDrawRound) {
  const next = latest + 1;
  const lastCutoff = Date.parse(`${drawDate(latest)}T11:00:00Z`);
  const day = new Date(Date.now() + KST).toISOString().slice(0, 10);
  // Keep this week's draw visible on draw day after the result is published.
  const calendarRound = 1 + Math.floor((Date.parse(day) - EPOCH) / WEEK);
  return day === drawDate(latest) && Date.now() >= lastCutoff ? latest : Math.max(next, calendarRound);
}

function displayState(round, record) {
  const date = drawDate(round);
  const cutoff = Date.parse(`${date}T11:00:00Z`);
  const publish = Date.parse(`${date}T11:35:00Z`);
  if (record?.state === 'invalid') return '무효 · 검증 실패';
  if (record?.state === 'evaluated') return '평가 완료';
  if (record?.state === 'confirmed') return Date.now() >= publish ? '결과 대기' : '확정';
  if (Date.now() >= cutoff) return '무효 · 마감 전 확정 기록 없음';
  if (record?.state === 'unconfirmed') return 'GitHub 확정 확인 대기';
  return '생성 전';
}

function healthLine() {
  const health = catalog.health || {};
  const pieces = [`공개 결과 ${fmt(catalog.latestDrawRound)}회`, `Pages 갱신 ${kst(catalog.builtAtUTC)}`];
  for (const [key, label] of [['predict', '예측'], ['evaluate', '평가']]) {
    if (health[key]) pieces.push(`${label} ${health[key].round ?? ''} ${health[key].reason} (${kst(health[key].checkedAtUTC)})`);
  }
  const kstDay = new Date(Date.now() + KST).toISOString().slice(0, 10);
  const expected = 1 + Math.floor((Date.parse(kstDay) - EPOCH) / WEEK);
  if (expected > catalog.latestDrawRound && Date.now() > Date.parse(`${drawDate(expected)}T13:20:00Z`)) {
    pieces.push(`${expected}회 추첨 자료 미반영`);
  }
  $('liveHealth').textContent = pieces.join(' · ');
}

function showTarget() {
  const round = targetRound();
  const entry = catalog.rounds.find(row => row.round === round);
  $('liveTarget').textContent = `${fmt(round)}회 · ${drawDate(round)} · ${displayState(round, entry)}`;
  const detail = details.get(round);
  const receipt = detail?.receipt;
  const prediction = detail?.prediction;
  $('liveCurrent').innerHTML = receipt && prediction ? roundDetail(detail, 'current') :
    '<p class="research-help">토요일 18:00 KST에 생성합니다. 20:00 KST 전에 GitHub 확정이 확인된 기록만 평가합니다.</p>';
}

function roundDetail(row, prefix) {
  const { prediction, receipt, evaluation } = row;
  if (!prediction || !receipt) return '<p class="research-help">확인된 조합이 없습니다.</p>';
  const draw = evaluation?.official || archived.get(row.round);
  const metadata = `<p class="research-help">생성 ${kst(prediction.generatedAtUTC)} · GitHub 확정 ${kst(receipt.confirmedAtUTC)} · ` +
    `확정 입력 ${prediction.history.first}~${prediction.latestFinalRound}회 · 시드 ${prediction.settings.seed}</p>` +
    `<p class="research-help">${/^[a-f0-9]{40}$/.test(receipt.commit) ? asLink(`${repoURL}/commit/${receipt.commit}`, '확정 커밋') : ''}` +
    `${validRunLink(receipt.workflow) ? ` · ${asLink(receipt.workflow, 'GitHub 실행 기록')}` : ''}</p>`;
  return metadata + (draw ? `<p class="research-help">당첨 ${draw.numbers.join(' · ')} · 보너스 ${draw.bonus}</p>` : '') +
    '<div class="live-ticket-grid">' + prediction.strategies.map((strategy, index) => {
      const outcome = evaluation?.strategies[index];
      return `<details${index === 0 && prefix === 'current' ? ' open' : ''}><summary>${escape(names.get(strategy.id))} <small>v${escape(strategy.version)}</small></summary>` +
        strategy.games.map((line, k) => {
          const score = outcome?.games[k];
          const grade = score ? `${score.matches}개${score.bonus ? ' + 보너스' : ''} · ${score.rank ? `${score.rank}등` : '낙첨'}` : '';
          return `<div class="live-game"><span>${line.join(' · ')}</span><span>${grade}${score?.prize === null ? ' · 금액 미확정' : ''}</span></div>`;
        }).join('') + '</details>';
    }).join('') + '</div>';
}

function trendGraph(data) {
  const strategy = data.strategies.find(row => row.id === $('liveTrendStrategy').value) || data.strategies[0];
  const baseline = data.strategies.find(row => row.id === 'random');
  if (!strategy.trend.length) return '';
  const left = 42, top = 10, right = 318, bottom = 116;
  const values = [.8, ...strategy.trend.map(point => point.mean), ...baseline.trend.map(point => point.mean)];
  const lo = Math.max(0, Math.min(...values) - .08), hi = Math.max(...values) + .08;
  const x = i => strategy.trend.length === 1 ? (left + right) / 2 : left + i * (right - left) / (strategy.trend.length - 1);
  const y = value => bottom - (bottom - top) * (value - lo) / (hi - lo);
  const draw = (points, color) => `<polyline points="${points.map((point, i) => `${x(i).toFixed(1)},${y(point.mean).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>` +
    `<circle cx="${x(points.length - 1)}" cy="${y(points.at(-1).mean)}" r="3" fill="${color}"/>`;
  return `<svg class="live-graph" viewBox="0 0 330 142" role="img" aria-label="${escape(strategy.label)} 누적 평균 ${number(strategy.mean)}, 무작위 ${number(baseline.mean)}">` +
    `<path d="M${left} ${top}V${bottom}H${right}" stroke="#516983" fill="none"/>` +
    `<line x1="${left}" x2="${right}" y1="${y(.8)}" y2="${y(.8)}" stroke="#f3c76e" stroke-dasharray="4 3"/>` +
    `<text x="0" y="${y(.8) + 4}" fill="#f3c76e" font-size="10">0.800</text>` +
    draw(baseline.trend, '#7fb6ff') + draw(strategy.trend, '#4ce3aa') +
    `<text x="${left}" y="133" fill="#95a8c3" font-size="10">${data.rounds[0]}회</text>` +
    `<text x="${right}" y="133" text-anchor="end" fill="#95a8c3" font-size="10">${data.rounds.at(-1)}회</text></svg>`;
}

function renderSummary() {
  if (!aggregate) return;
  const count = aggregate.rounds.length;
  $('liveSample').textContent = count ? `평가 ${fmt(count)}회 · 전략당 ${fmt(count * 5)}게임 · ${count < MIN_LIVE_ROUNDS ? '표본 부족' : '회차 단위 95% 추정 구간'}`
    : '평가 완료된 사전 확정 예측이 없습니다.';
  $('liveSummary').innerHTML = count ? '<div class="tablewrap research-table" tabindex="0" aria-label="실전 전략별 누적 성과"><table class="datatable"><thead>' +
    '<tr><th>전략</th><th>평균 적중 / 95%</th><th>이론 0.800 대비</th><th>같은 회차 무작위 대비 / 95%</th><th>3/4/5/6개</th><th>1/2/3/4/5등</th><th>누적 비용</th><th>세전 당첨금</th><th>손익 / 수익률</th></tr>' +
    `</thead><tbody>${aggregate.strategies.map(row => `<tr><td>${row.label}</td><td>${number(row.mean)}<br>${interval(row.interval)}</td>` +
      `<td>${signed(row.theoreticalDelta)}</td><td>${signed(row.pairedDelta)}<br>${interval(row.pairedInterval)}</td>` +
      `<td>${row.hits.slice(3).join(' / ')}</td><td>${row.ranks.slice(1).join(' / ')}</td>` +
      `<td>${money(row.spent)}</td><td>${money(row.prize)}${row.unpriced ? ` + 미확정 ${row.unpriced}게임` : ''}</td>` +
      `<td>${row.net === null ? '금액 미확정' : `${money(row.net)} / ${(row.roi * 100).toFixed(2)}%`}</td></tr>`).join('')}</tbody></table></div>` : '';
  $('liveTrendStrategy').disabled = !count;
  $('liveTrend').innerHTML = trendGraph(aggregate);
  renderComparison();
}

function renderComparison() {
  const offline = backtest?.evaluation.length;
  const count = aggregate?.rounds.length || 0;
  $('liveComparison').innerHTML = `<p class="research-help">과거 워크포워드 ${offline ? `${backtest.evaluation[0]}~${backtest.evaluation.at(-1)}회 · ${fmt(offline)}회` : '평가 실행 전 또는 자료 부족'}` +
    ` · 사전 확정 실전 ${count ? `${aggregate.rounds[0]}~${aggregate.rounds.at(-1)}회 · ${fmt(count)}회` : '평가 대기'}</p>` +
    (offline || count ? '<div class="tablewrap research-table" tabindex="0" aria-label="백테스트와 사전 확정 실전 비교"><table class="datatable"><thead>' +
      '<tr><th>전략</th><th>과거 평균 일치</th><th>실전 평균 일치</th></tr></thead><tbody>' + STRATEGIES.map(([id, label], i) =>
        `<tr><td>${label}</td><td>${number(backtest?.strategies[i]?.evaluation?.mean)}</td><td>${number(aggregate?.strategies[i]?.mean)}</td></tr>`).join('') +
      '</tbody></table></div>' : '');
}

async function showHistory() {
  const seq = ++detailId;
  const round = Number($('liveHistoryRound').value);
  if (!round) { $('liveHistory').textContent = '자동 예측 기록이 아직 없습니다.'; return; }
  $('liveHistory').textContent = '회차 기록을 확인하는 중…';
  try {
    const data = details.get(round) || await fetchJSON(`${round}.json`, AbortSignal.timeout(12_000));
    if (seq !== detailId) return;
    $('liveHistory').innerHTML = `<p class="research-help">${round}회 · ${displayState(round, data)}</p>` + roundDetail(data, 'history');
  } catch {
    if (seq === detailId) $('liveHistory').textContent = '해당 회차 파일을 확인할 수 없습니다.';
  }
}

async function refresh() {
  const seq = ++refreshId;
  request?.abort();
  request = new AbortController();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(16_000)]);
  $('liveRefresh').disabled = true;
  $('liveLoad').textContent = '공개 기록을 확인하는 중…';
  try {
    const index = await fetchJSON('index.json', signal);
    if (index.schema !== 1 || !Array.isArray(index.rounds) || !Number.isInteger(index.latestDrawRound) ||
        !Array.isArray(index.summary?.rounds) || index.summary.strategies?.length !== STRATEGIES.length) throw Error('공개 기록 형식 오류');
    if (seq !== refreshId) return;
    const target = targetRound(index.latestDrawRound);
    const current = index.rounds.find(row => row.round === target);
    const currentDetail = current && ['confirmed', 'evaluated'].includes(current.state) ? await fetchJSON(`${target}.json`, signal) : null;
    if (currentDetail && (currentDetail.round !== target || currentDetail.state !== current.state)) throw Error('회차 파일 갱신 중');
    if (seq !== refreshId) return;
    catalog = index;
    details = new Map(currentDetail ? [[target, currentDetail]] : []);
    aggregate = index.summary;
    $('liveHistoryRound').innerHTML = index.rounds.slice().reverse().map(row => `<option value="${row.round}">${row.round}회 · ${displayState(row.round, row)}</option>`).join('');
    if (current) $('liveHistoryRound').value = String(target);
    healthLine();
    showTarget();
    renderSummary();
    showHistory();
    $('liveLoad').textContent = '공개 기록 확인 완료';
    loaded = true;
  } catch {
    if (seq === refreshId) $('liveLoad').textContent = loaded ? '갱신 실패 · 마지막으로 읽은 기록 표시 중' : '공개 기록을 불러오지 못했습니다.';
  } finally { if (seq === refreshId) $('liveRefresh').disabled = false; }
}

$('liveTrendStrategy').innerHTML = STRATEGIES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
$('liveTrendStrategy').addEventListener('change', () => { if (aggregate) $('liveTrend').innerHTML = trendGraph(aggregate); });
$('liveHistoryRound').addEventListener('change', showHistory);
$('liveRefresh').addEventListener('click', refresh);
document.querySelector('[data-tab="live"]').addEventListener('click', () => {
  active = true;
  if (!loaded && !$('liveRefresh').disabled) refresh();
  if (!backtest) window.dispatchEvent(new Event('lotto-backtest-request'));
});
window.addEventListener('lotto-backtest-result', event => { backtest = event.detail; if (active) renderComparison(); });
window.addEventListener('lotto-draws-changed', event => {
  archived = new Map(event.detail.map(row => [row.round, row]));
  if (active && !backtest) window.dispatchEvent(new Event('lotto-backtest-request'));
});
if (window.lottoResearchDraws) archived = new Map(window.lottoResearchDraws.map(row => [row.round, row]));
