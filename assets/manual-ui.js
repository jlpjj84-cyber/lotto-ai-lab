import { RECOMMENDATION_STRATEGIES as STRATEGIES } from './strategy-catalog.js';
import { EXPECTED_MATCHES } from './research-backtest.js';
import { DEFAULT_SEED } from './research-math.js';
import { createManualRecord, MANUAL_KEY, manualOutcome, readManualRecords, removeManualRecord } from './manual-generation.js';
import { recommendationHTML, recommendationReport } from './recommendation-report.js';
import { datasetStamp, sealResearch } from './research-provenance.js';
import { backtestEvidence, simulationEvidence } from './selection-evidence.js';
import { AUTO_CHAIN_ID } from './chain-auto.js';
import { getAutoChainService } from './chain-auto-service.js';

const $ = id => document.getElementById(id);
const names = new Map(STRATEGIES);
const kst = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
const money = value => `${value.toLocaleString('ko-KR')}원`;
const rowLabel = record => `${names.get(record.strategy)} v${record.version}`;
const optionsText = record => [record.options.uniqueLines ? '동일 조합 제외' : '', record.options.spread ? '게임 간 번호 중복 금지' : ''].filter(Boolean).join(' · ') || '기본 옵션';
let draws = window.lottoResearchDraws || [];
let baseline = window.lottoBacktestResult;
let records = [];
let latest = null;
let active = false;
let historyLimit = 30;
let savingPurchase = false;
const purchased = new Set();

function read() {
  try { records = readManualRecords(localStorage.getItem(MANUAL_KEY)); }
  catch { $('manualGenStatus').textContent = '생성 기록을 읽지 못했습니다. 저장된 원본을 확인해 주세요.'; }
}

function renderEvidence() {
  const evidence = $('manualEvidence');
  evidence.hidden = Boolean(latest);
  if (latest) return;
  const choice = $('manualStrategy').value;
  if (choice === AUTO_CHAIN_ID) {
    const state = getAutoChainService().getState(), v = state.record?.result.validation;
    evidence.textContent = v ? `자동 워크포워드 ${v.n}회 · ${v.status}. 데이터가 갱신되면 자동 재분석합니다. 시드·게임 수·중복 제한 변경은 참고 성적으로만 표시합니다.` : '자동 연쇄 분석 중입니다. 완료 후 실험 추천을 생성할 수 있습니다.';
    return;
  }
  const result = baseline?.strategies.find(row => row.id === choice)?.evaluation;
  const random = baseline?.strategies.find(row => row.id === 'random')?.evaluation;
  const delta = value => `${value >= 0 ? '+' : ''}${value.toFixed(3)}개`;
  const reference = result?.games ?
    `과거 워크포워드 ${result.draws}회 · 평균 ${result.mean.toFixed(3)}개 · 이론 0.800 대비 ${delta(result.mean - EXPECTED_MATCHES)} · ` +
    (choice !== 'random' && random?.games ? `같은 기간 무작위 ${random.mean.toFixed(3)} 대비 ${delta(result.mean - random.mean)} · ` : '') +
    (choice === 'random' ? '무작위 기준 전략' : result.adjusted === null ? '유의성 판단 표본 부족' :
      `보정 p ${result.adjusted.toFixed(4)} · ${result.adjusted <= .05 ? '과거 구간에서 유의한 차이' : '통계적 우위 확인 없음'}`)
    : '과거 워크포워드 평가 대기 또는 표본 부족';
  const sameWindow = !baseline?.settings?.window && (baseline?.settings?.trainStart ?? 1) === 1;
  const comparable = sameWindow && $('manualGames').valueAsNumber === 5 && !$('manualUnique').checked &&
    !$('manualSpread').checked && $('manualSeed').valueAsNumber === DEFAULT_SEED;
  evidence.textContent = comparable ? reference : `기존 백테스트의 직접 비교 대상이 아닌 설정입니다. 전략 참고 성적 · ${reference}`;
}

function renderLatest() {
  $('manualCopy').disabled = !latest;
  $('manualCopyReport').disabled = !latest;
  $('manualSavePurchase').disabled = !latest || latest.lines.length > 5 || savingPurchase || purchased.has(latest.id);
  $('manualSavePurchase').title = latest?.lines.length > 5 ? '구매 기록 1건에는 최대 5게임을 넣을 수 있습니다.' : '';
  $('manualGenOutput').innerHTML = latest ? `<p class="research-help">${latest.round}회 · ${rowLabel(latest)} · ` +
    `${kst(latest.generatedAtUTC)} KST · 데이터 ${latest.dataRound}회까지 · 시드 ${latest.seed}</p>` +
    `<p class="research-help">사용 이력 ${latest.historyCount ? `${latest.historyFirst}~${latest.dataRound}회 중 ${latest.historyCount}회` : '번호 선택에는 이력 미사용'}</p>` +
    recommendationHTML(latest) : '';
  renderEvidence();
}

function renderHistory() {
  const drawByRound = new Map(draws.map(row => [row.round, row]));
  const list = $('manualGenHistory');
  $('manualGenCount').textContent = `${records.length.toLocaleString('ko-KR')}건 · 이 브라우저에 저장`;
  $('manualGenMore').hidden = true;
  if (!records.length) { list.textContent = '저장된 수동 생성 조합이 없습니다.'; return; }
  const selected = $('manualGenRound').value;
  const filters = [...new Set(records.map(record => record.round))].sort((a, b) => b - a);
  $('manualGenRound').innerHTML = '<option value="all">전체</option>' + filters.map(round => `<option value="${round}">${round}회</option>`).join('');
  $('manualGenRound').value = filters.includes(Number(selected)) ? selected : 'all';
  const matching = records.filter(record => $('manualGenRound').value === 'all' || record.round === Number($('manualGenRound').value));
  $('manualGenMore').hidden = matching.length <= historyLimit;
  list.innerHTML = matching.slice(-historyLimit).reverse().map(record => {
    const result = manualOutcome(record, drawByRound.get(record.round));
    return `<div class="manual-history-row"><details class="manual-history-item"><summary>${record.round}회 · ${rowLabel(record)} · ${record.lines.length}게임 · ` +
      `${result ? `평균 ${result.mean.toFixed(3)}개` : '결과 대기'}</summary>` +
      `<p class="research-help">${kst(record.generatedAtUTC)} KST · 기준 ${record.dataRound}회 · 시드 ${record.seed} · ${optionsText(record)}</p>` +
      record.lines.map((line, i) => `<div class="live-game"><span>${line.join(' · ')}</span><span>${result ?
        `${result.games[i].matches}개${result.games[i].bonus ? ' + 보너스' : ''} · ${result.games[i].rank ? `${result.games[i].rank}등` : '낙첨'}` : ''}</span></div>`).join('') +
      (result ? `<p class="research-help">세전 당첨금 ${money(result.prize)}${result.unpriced ? ` + 미확정 ${result.unpriced}게임` : ''}</p>` : '') + `</details><button type="button" class="btn tinybtn manual-delete" data-manual-delete="${record.id}" aria-label="${record.round}회 수동 생성 기록 삭제">삭제</button></div>`;
  }).join('');
}

async function removeSavedRecord(id) {
  const remove = () => {
    const result = removeManualRecord(localStorage.getItem(MANUAL_KEY), id);
    if (result.removed) {
      localStorage.setItem(MANUAL_KEY, JSON.stringify({ schema: 1, records: result.records }));
    }
    records = result.records;
    return result.removed;
  };
  const removed = navigator.locks ? await navigator.locks.request(MANUAL_KEY, remove) : remove();
  if (latest?.id === id && removed) { latest = null; renderLatest(); }
  renderHistory();
  $('manualHistoryStatus').textContent = removed
    ? '수동 생성 기록 1건을 이 브라우저에서 삭제했습니다. 별도 구매 기록과 GitHub 사전 확정 기록은 유지됩니다.'
    : '이미 삭제된 기록입니다. 목록을 새로 고쳤습니다.';
  if (removed) window.dispatchEvent(new Event('lotto-research-saved'));
}

async function generate() {
  const button = $('manualGenerate');
  button.disabled = true;
  try {
    const input = $('manualSeed');
    const seed = input.value.trim() ? input.valueAsNumber : crypto.getRandomValues(new Uint32Array(1))[0];
    const source = draws;
    const historical = baseline;
    const monteCarlo = window.lottoMonteCarloResult;
    const draft = createManualRecord(source, {
      strategy: $('manualStrategy').value, games: $('manualGames').valueAsNumber,
      uniqueLines: $('manualUnique').checked, spread: $('manualSpread').checked, seed, id: crypto.randomUUID(), explain: true,
      autoChain: getAutoChainService().getState().record,
    });
    const data = await datasetStamp(source);
    draft.research.data = data;
    if (draft.strategy !== AUTO_CHAIN_ID) draft.research.validation = {
      backtest: backtestEvidence(historical?.data?.sha256 === data.sha256 ? historical : null, draft.strategy),
      monteCarlo: simulationEvidence(monteCarlo?.data?.sha256 === data.sha256 ? monteCarlo : null, draft.strategy),
    };
    const record = await sealResearch(draft);
    const save = () => {
      const stored = readManualRecords(localStorage.getItem(MANUAL_KEY));
      const next = [...stored, record];
      localStorage.setItem(MANUAL_KEY, JSON.stringify({ schema: 1, records: next }));
      records = next;
    };
    if (navigator.locks) await navigator.locks.request(MANUAL_KEY, save);
    else save();
    latest = record;
    $('manualGenStatus').textContent = '생성 기록에 저장했습니다.';
    renderLatest();
    renderHistory();
    window.dispatchEvent(new Event('lotto-research-saved'));
  } catch (error) { $('manualGenStatus').textContent = error.message; }
  finally { button.disabled = false; }
}

$('manualStrategy').innerHTML = STRATEGIES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
$('manualStrategy').value = 'spread';
$('manualGenerate').addEventListener('click', generate);
$('manualGenHistory').addEventListener('click', async event => {
  const button = event.target.closest('button[data-manual-delete]');
  if (!button || !$('manualGenHistory').contains(button)) return;
  const record = records.find(item => item.id === button.dataset.manualDelete);
  if (!record) { $('manualHistoryStatus').textContent = '삭제할 기록을 찾지 못했습니다. 목록을 새로 고쳐 주세요.'; return; }
  const message = record.round + '회 · ' + kst(record.generatedAtUTC) + ' 생성 기록 1건을 삭제할까요?\n복원하려면 미리 내보낸 연구 JSON 백업이 필요합니다.';
  if (!window.confirm(message)) return;
  button.disabled = true;
  try { await removeSavedRecord(record.id); }
  catch (error) { $('manualHistoryStatus').textContent = '삭제 실패: ' + error.message; button.disabled = false; }
});
$('manualGenRound').addEventListener('change', () => { historyLimit = 30; renderHistory(); });
$('manualGenMore').addEventListener('click', () => { historyLimit += 30; renderHistory(); });
$('manualCopy').addEventListener('click', async () => {
  if (!latest) return;
  try {
    await navigator.clipboard.writeText(latest.lines.map(line => line.join(' ')).join('\n'));
    $('manualGenStatus').textContent = '번호를 복사했습니다.';
  } catch { $('manualGenStatus').textContent = '클립보드에 복사하지 못했습니다.'; }
});
$('manualCopyReport').addEventListener('click', async () => {
  if (!latest) return;
  try {
    await navigator.clipboard.writeText(recommendationReport(latest));
    $('manualGenStatus').textContent = '추천 보고서를 복사했습니다.';
  } catch { $('manualGenStatus').textContent = '클립보드에 복사하지 못했습니다.'; }
});
$('manualSavePurchase').addEventListener('click', async () => {
  const record = latest;
  if (!record || record.lines.length > 5 || savingPurchase || purchased.has(record.id)) return;
  savingPurchase = true;
  $('manualSavePurchase').disabled = true;
  try {
    await window.lottoPurchaseRecord(record.round, record.lines.map((numbers, i) => ({
      label: 'ABCDE'[i], type: '직접 입력', numbers,
    })), `전략 선택형 · ${rowLabel(record)}`);
    purchased.add(record.id);
    $('manualGenStatus').textContent = '구매 기록에 별도로 추가했습니다.';
  } catch (error) { $('manualGenStatus').textContent = error.message; }
  finally { savingPurchase = false; renderLatest(); }
});
for (const id of ['manualStrategy', 'manualGames', 'manualUnique', 'manualSpread', 'manualSeed']) {
  $(id).addEventListener('change', () => { latest = null; renderLatest(); });
}
document.querySelector('[data-tab="generator"]').addEventListener('click', () => {
  active = true;
  renderHistory();
  renderEvidence();
  if (!baseline) window.dispatchEvent(new Event('lotto-backtest-request'));
});
window.addEventListener('lotto-draws-changed', event => {
  draws = event.detail;
  if (active) {
    renderHistory();
    if (!baseline) window.dispatchEvent(new Event('lotto-backtest-request'));
  }
});
window.addEventListener('lotto-backtest-result', event => { baseline = event.detail; if (active) renderEvidence(); });
window.addEventListener('storage', event => {
  if (event.key === MANUAL_KEY || event.key === null) { read(); if (latest && !records.some(item => item.id === latest.id)) { latest = null; renderLatest(); } if (active) renderHistory(); }
});
window.addEventListener('lotto-recommendations-restored', () => { read(); if (active) renderHistory(); });
read();
getAutoChainService().subscribe(state => {
  if ($('manualStrategy').value === AUTO_CHAIN_ID && !latest) renderEvidence();
});
