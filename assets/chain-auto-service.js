import { autoInputKey, AUTO_CHAIN_KEY, confirmedAutoInput, savedAutoRecords, saveAutoSnapshot, uniformAutoSnapshot, verifyAutoSnapshot } from './chain-auto-record.js';
import { cleanChainRows } from './chain-research.js';

export function createAutoChainService({ storage, fetcher = globalThis.fetch, WorkerClass = globalThis.Worker,
  artifactURL, now = () => new Date(), options = {} } = {}) {
  let state = { phase: 'idle', progress: 0, record: null, warning: '' }, revision = 0, worker = null, request = null, raw = null;
  const listeners = new Set();
  const emit = value => { state = { ...state, ...value }; listeners.forEach(listener => listener(state)); };
  const stop = () => { if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); worker = null; } request?.abort(); request = null; };
  const service = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    cancel() { revision++; stop(); raw = null; emit({ phase: 'cancelled', record: null, warning: '자동 분석을 취소했습니다. 다시 분석하거나 새 자료가 들어오면 재개합니다.' }); },
    async load(rows, force = false) {
      const signature = JSON.stringify(rows);
      if (!force && raw === signature && ['loading', 'running', 'ready'].includes(state.phase)) return;
      raw = signature; const current = ++revision; stop();
      let trustedInput = false;
      emit({ phase: 'loading', progress: 0, record: null, warning: '' });
      const isCurrent = () => current === revision;
      const ready = async (record, source) => {
        if (!isCurrent()) return;
        if (!await verifyAutoSnapshot(record, rows, options)) throw Error('자동 분석의 자료/해시 검증에 실패했습니다.');
        if (!isCurrent()) return;
        let warning = state.warning || (!storage && source === 'browser' ? '브라우저 저장을 사용할 수 없어 현재 화면에만 보관합니다.' : '');
        if (storage && record.result.analysisState !== 'failed') {
          try { await saveAutoSnapshot(record, storage); } catch (error) { warning = `자동 저장 실패: ${error.message}`; }
        }
        if (isCurrent()) emit({ phase: 'ready', progress: 1, record, source, warning });
      };
      const fail = async error => {
        if (!isCurrent()) return;
        stop();
        try {
          const fallback = await uniformAutoSnapshot(rows, `자동 분석 실패: ${error.message || error}`, options, now());
          if (isCurrent()) emit({ phase: 'ready', progress: 1, record: fallback, source: 'fallback', warning: fallback.result.model.fallbackReason });
        } catch (invalid) { if (isCurrent()) emit({ phase: 'error', record: null, warning: invalid.message }); }
      };
      try {
        cleanChainRows(rows); confirmedAutoInput(rows, now());
        trustedInput = true;
        const { key } = await autoInputKey(rows, options);
        if (!isCurrent()) return;
        if (storage && !force) {
          try {
            const cached = savedAutoRecords(storage.getItem(AUTO_CHAIN_KEY)).find(r => r.id === key && r.result.analysisState !== 'failed');
            if (cached) { await ready(cached, 'cache'); return; }
          } catch (error) { emit({ warning: `기존 자동 저장본 보존: ${error.message}` }); }
        }
        if (fetcher && artifactURL && !force) {
          const controller = new AbortController(); request = controller;
          const timer = setTimeout(() => controller.abort(), 4000);
          try {
            const response = await fetcher(artifactURL, { cache: 'no-cache', signal: controller.signal });
            if (response.ok) {
              const record = await response.json();
              if (record.result?.analysisState !== 'failed' && await verifyAutoSnapshot(record, rows, options)) { await ready(record, 'server'); return; }
            }
          } catch { /* Current data will be recomputed locally below. */ }
          finally { clearTimeout(timer); if (request === controller) request = null; }
        }
        if (!isCurrent()) return;
        emit({ phase: 'running', progress: 0 });
        if (!WorkerClass) throw Error('백그라운드 계산을 사용할 수 없습니다.');
        worker = new WorkerClass(new URL('./chain-auto-worker.js', import.meta.url), { type: 'module' });
        worker.onerror = () => fail(Error('백그라운드 분석 파일을 불러오지 못했습니다.'));
        worker.onmessage = async ({ data }) => {
          if (!isCurrent()) return;
          if (data.progress !== undefined) { emit({ progress: data.progress }); return; }
          if (data.error) { await fail(Error(data.error)); return; }
          if (data.result) {
            stop();
            try { await ready(data.result, 'browser'); } catch (error) { await fail(error); }
          }
        };
        worker.postMessage({ rows, options, nowUTC: now().toISOString() });
      } catch (error) {
        if (!trustedInput) { if (isCurrent()) emit({ phase: 'error', record: null, warning: error.message }); }
        else await fail(error);
      }
    },
  };
  return service;
}

let singleton;
export function getAutoChainService() {
  if (!singleton) {
    let storage;
    try { storage = globalThis.localStorage; } catch { /* Computing remains available. */ }
    singleton = createAutoChainService({ storage,
      artifactURL: new URL('./data/chain-auto/latest.json', document.baseURI).href });
  }
  return singleton;
}
