import { recommendationHTML } from './recommendation-report.js';
import { manualOutcome, MANUAL_KEY } from './manual-generation.js';
import { EXPERIMENT_KEY, exportResearch, importResearch, verifyManual } from './research-archive.js';
import { verifiedResearch } from './research-provenance.js';
import { RECOMMENDATION_STRATEGIES as STRATEGIES } from './strategy-catalog.js';

const $ = id => document.getElementById(id);
const names = new Map(STRATEGIES);
const kst = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const fmt = value => value.toLocaleString('ko-KR');
const fixed = value => Number.isFinite(value) ? value.toFixed(3) : '—';
const safe = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
let draws = window.lottoResearchDraws ?? [];
let experiments = new Map();
let active = false;
let rendering = 0;

function recommendation(record, integrity, draw) {
  const outcome = integrity === 'mismatch' ? null : manualOutcome(record, draw);
  const match = outcome ? `평균 ${fixed(outcome.mean)}개 일치` : '결과 대기';
  const label = integrity === 'verified' ? 'SHA-256 일치' : integrity === 'legacy' ? '이전 기록 · SHA-256 없음' : '무결성 확인 실패';
  const evidence = integrity === 'verified' ? record.research : null;
  const scores = outcome?.games.map(game => `${game.matches}개 · ${game.rank ? `${game.rank}등` : '낙첨'}`);
  return `<details class="manual-history-item"><summary>${record.round}회 · ${safe(names.get(record.strategy))} · ${label} · ${integrity === 'mismatch' ? '평가 제외' : match}</summary>` +
    `<p class="research-help">${kst(record.generatedAtUTC)} KST · v${safe(record.version)} · 데이터 기준 ${record.dataRound}회 · 시드 ${record.seed}` +
    (evidence ? ` · 입력 SHA-256 <code class="study-digest">${safe(evidence.data.sha256)}</code>` : '') + '</p>' +
    recommendationHTML({ ...record, research: evidence }, scores) + '</details>';
}

const describe = ({ result, generatedAtUTC }) =>
  `${kst(generatedAtUTC)} · ${result.mode === 'adaptive' ? '순차 갱신' : '조합 고정'} · ${fmt(result.repetitions)}회 · 시드 ${result.seed}`;

function renderExperiment(record, integrity) {
  const { result } = record;
  if (!integrity) return `<p class="research-help">${safe(record.id)} · 무결성 확인 실패</p>`;
  return `<details class="manual-history-item"><summary>${safe(describe(record))} · SHA-256 일치</summary>` +
    `<p class="research-help">평가 ${result.played[0]}~${result.played.at(-1)}회 중 ${result.played.length}회 · ${fmt(result.games)}게임 · 모델 ${safe(result.modelVersion)} · 전략 v${safe(result.strategyVersion)}</p>` +
    `<p class="research-help">입력 SHA-256 <code class="study-digest">${safe(result.data.sha256)}</code></p>` +
    `<p class="research-help">설정 <code class="study-digest">${safe(JSON.stringify(result.settings))}</code></p>` +
    result.strategies.map(row => `<div class="live-game"><span>${safe(names.get(row.id))}</span><span>관측 평균 ${fixed(row.observedMean)}개 · 무작위 대비 ${fixed(row.observedDelta)}개 · 보정 p ${fixed(row.adjusted)}</span></div>`).join('') +
    '</details>';
}

function compare() {
  const first = experiments.get($('archiveStudy').value)?.result;
  const second = experiments.get($('archiveCompare').value)?.result;
  const output = $('archiveComparison');
  if (!first || !second) { output.textContent = ''; return; }
  const same = first.data.sha256 === second.data.sha256 && JSON.stringify(first.settings) === JSON.stringify(second.settings) &&
    first.mode === second.mode && first.modelVersion === second.modelVersion && first.strategyVersion === second.strategyVersion;
  const selected = first.strategies.flatMap(row => {
    const other = second.strategies.find(item => item.id === row.id);
    return other ? [`<div class="live-game"><span>${safe(names.get(row.id))}</span><span>` +
      `무작위 대비 ${fixed(row.observedDelta)} → ${fixed(other.observedDelta)} · 보정 p ${fixed(row.adjusted)} → ${fixed(other.adjusted)}</span></div>`] : [];
  });
  output.innerHTML = `<p class="research-help">${same ? '같은 데이터·방법·평가 조건입니다. 반복·시드나 검정한 전략 수는 각 기록에서 확인하세요.' :
    '데이터나 평가 조건이 달라 수치를 나란히 참고할 수 있습니다.'}</p>` +
    (selected.join('') || '<p class="research-help">공통 전략이 없습니다.</p>');
}

async function render() {
  const epoch = ++rendering;
  try {
    const byRound = new Map(draws.map(draw => [draw.round, draw]));
    const manual = exportResearch('recommendations').records.slice().reverse();
    const saved = exportResearch('experiments').records.slice().reverse();
    const recommendations = await Promise.all(manual.map(async record => recommendation(record, await verifyManual(record), byRound.get(record.round))));
    const verified = await Promise.all(saved.map(verifiedResearch));
    if (!active || epoch !== rendering) return;
    $('archiveRecommendations').innerHTML = recommendations.join('') || '<p class="research-help">저장된 수동 추천이 없습니다.</p>';
    $('archiveStudies').innerHTML = saved.map((record, i) => renderExperiment(record, verified[i])).join('') ||
      '<p class="research-help">몬테카를로 연구실에서 결과를 저장하면 이곳에 나타납니다.</p>';
    experiments = new Map(saved.filter((_, i) => verified[i]).map(record => [record.id, record]));
    for (const id of ['archiveStudy', 'archiveCompare']) {
      const select = $(id);
      const previous = select.value;
      select.innerHTML = '<option value="">선택</option>' + [...experiments.values()].map(record =>
        `<option value="${record.id}">${safe(describe(record))}</option>`).join('');
      if (experiments.has(previous)) select.value = previous;
    }
    compare();
  } catch {
    if (epoch === rendering) $('archiveStatus').textContent = '이 브라우저에 저장된 연구 기록을 읽지 못했습니다.';
  }
}

function download(kind) {
  try {
    const content = JSON.stringify(exportResearch(kind), null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    link.download = `lotto-lab-${kind}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
  } catch (error) { $('archiveStatus').textContent = error.message; }
}

$('archiveExportManual').addEventListener('click', () => download('recommendations'));
$('archiveExportStudies').addEventListener('click', () => download('experiments'));
$('archiveImport').addEventListener('change', async event => {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw Error('연구 JSON은 10 MB 이하 파일을 불러올 수 있습니다.');
    const backup = JSON.parse(await file.text());
    const count = await importResearch(backup);
    $('archiveStatus').textContent = `연구 기록 ${fmt(count)}건을 추가했습니다. 기존 기록은 유지했습니다.`;
    if (backup.kind === 'recommendations') window.dispatchEvent(new Event('lotto-recommendations-restored'));
    await render();
  } catch (error) { $('archiveStatus').textContent = `복원 실패 · ${error.message}`; }
  finally { input.value = ''; }
});
for (const id of ['archiveStudy', 'archiveCompare']) $(id).addEventListener('change', compare);
document.querySelector('[data-tab="archive"]').addEventListener('click', () => { active = true; render(); });
window.addEventListener('lotto-research-saved', () => { if (active) render(); });
window.addEventListener('lotto-draws-changed', ({ detail }) => { draws = detail; if (active) render(); });
window.addEventListener('storage', ({ key }) => {
  if (active && [null, MANUAL_KEY, EXPERIMENT_KEY].includes(key)) render();
});
