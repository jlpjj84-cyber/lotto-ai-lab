import { AUTO_CHAIN_ID, AUTO_CHAIN_VERSION, autoChainSettings, autoHistorySignature, automaticChainAnalysis, generateChainGames } from './chain-auto.js';
import { datasetStamp, researchDigest, sealResearch, verifiedResearch } from './research-provenance.js';
import { scheduleFor } from './lotto-calendar.js';
import { generateRankedGames, emptyRankingModel } from './chain-ranking.js';
import { generateControlGames } from './chain-control.js';

export const AUTO_CHAIN_KEY = 'lotto_lab_v52_auto_chain';
export const AUTO_CHAIN_RECORD_LIMIT = 3;

export function confirmedAutoInput(input, now = new Date()) {
  if (!Array.isArray(input) || !input.length) throw Error('확정 본번호 데이터가 없습니다.');
  for (const row of input) {
    const when = scheduleFor(row.round);
    if (row.date !== when.date || Date.parse(`${when.date}T11:35:00Z`) > now.getTime()) throw Error(`${row.round}회는 확정 시각/날짜를 검증하지 못했습니다.`);
  }
  return input;
}
export async function autoInputKey(rows, options = {}) {
  const data = await datasetStamp(rows);
  const settings = autoChainSettings(options);
  return { data, key: await researchDigest({ version: AUTO_CHAIN_VERSION, data: data.sha256, settings }) };
}
export async function createAutoSnapshot(rows, options = {}, progress = () => {}, now = new Date()) {
  confirmedAutoInput(rows, now);
  const { data, key } = await autoInputKey(rows, options);
  const result = automaticChainAnalysis(rows, options, progress);
  return sealResearch({ schema: 1, kind: 'auto-chain', id: key, generatedAtUTC: now.toISOString(),
    source: 'automatic-research', officialPreDraw: false, data, result });
}
export async function uniformAutoSnapshot(rows, reason, options = {}, now = new Date()) {
  const { data, key } = await autoInputKey(rows, options), settings = autoChainSettings(options);
  const model = emptyRankingModel(data.last + 1, reason);
  const control = generateControlGames(model.target, { seed: settings.seed });
  return sealResearch({ schema: 1, kind: 'auto-chain', id: key, generatedAtUTC: now.toISOString(), source: 'automatic-research',
    officialPreDraw: false, data, result: { version: AUTO_CHAIN_VERSION, strategy: AUTO_CHAIN_ID, settings, analysisState: 'failed',
      data: { first: data.first, latest: data.last, count: data.count, signature: autoHistorySignature(rows), complete: false },
      model, recommendation: { target: model.target, ...scheduleFor(model.target), lines: [], trace: [], unavailable: true, mode: 'evidence' },
      control: { target: model.target, ...scheduleFor(model.target), ...control },
      validation: { n: 0, games: 0, rounds: [], experimentalMean: null, baselineMean: null, difference: null, interval: null,
        pValue: null, status: '검증 대기 · 분석 실패로 평가하지 않음' },
      search: { registered: 0, pending: 0, limits: {}, policy: reason }, durationMs: 0 } });
}
export async function verifyAutoSnapshot(record, rows, options = {}) {
  if (!record || record.schema !== 1 || record.kind !== 'auto-chain' || record.source !== 'automatic-research' ||
    record.officialPreDraw !== false || record.result?.version !== AUTO_CHAIN_VERSION || !Number.isFinite(Date.parse(record.generatedAtUTC)) ||
    !await verifiedResearch(record)) return false;
  const input = await autoInputKey(rows, options), result = record.result;
  return record.id === input.key && record.data.sha256 === input.data.sha256 &&
    result.data.latest === input.data.last && result.data.count === input.data.count &&
    result.data.signature === autoHistorySignature(rows) &&
    result.model.target === input.data.last + 1 && result.recommendation.target === input.data.last + 1 &&
    JSON.stringify(result.settings) === JSON.stringify(autoChainSettings(options)) &&
    (result.recommendation.unavailable ? result.recommendation.lines.length === 0 && result.recommendation.trace.length === 0 &&
      (result.analysisState === 'failed' || !result.data.complete) :
      validChainSelection(result.recommendation.lines, result.recommendation.trace, result.model)) &&
    validChainSelection(result.control?.lines, result.control?.trace, result.model, { mode: 'control', seed: result.settings.seed });
}

export function validChainSelection(lines, trace, model, options = {}) {
  if (model?.scores) {
    if (!Array.isArray(lines) || !Array.isArray(trace) || lines.length < 1 || lines.length > 20 || lines.length !== trace.length ||
      model.scores.length !== 45 || model.scores.some((r, i) => r.number !== i + 1 || !Number.isFinite(r.score))) return false;
    const sorted = [...model.scores].sort((a, b) => b.score - a.score || a.number - b.number);
    if (sorted.some((r, i) => r.rank !== i + 1)) return false;
    if (model.scores.some(r => Math.abs(r.score / 100 - r.components.reduce((n, c) => n + c.contribution, 0)) > 1e-12)) return false;
    try {
      const generated = options.mode === 'control' ? generateControlGames(model.target, { ...options, games: lines.length }) :
        generateRankedGames(model, { ...options, games: lines.length });
      return JSON.stringify(lines) === JSON.stringify(generated.lines) && JSON.stringify(trace) === JSON.stringify(generated.trace);
    } catch { return false; }
  }
  // Historical v5.2.1 manual records retain their original schema and hash.
  if (!Array.isArray(lines) || !Array.isArray(trace) || lines.length !== trace.length || !Array.isArray(model?.weights) ||
    model.weights.length !== 46 || !model.weights.every(w => Number.isFinite(w) && w >= 1 && w <= 2) || !Array.isArray(model.candidates)) return false;
  const known = new Map(model.candidates.map(p => [p.id, p]));
  return lines.every((line, i) => Array.isArray(line) && line.length === 6 && line.every((n, j) => Number.isInteger(n) && n >= 1 && n <= 45 && (!j || line[j - 1] < n)) &&
    ['chain', 'uniform'].includes(trace[i]?.method) && Array.isArray(trace[i].decisions) && trace[i].decisions.length === 6 &&
    line.every(n => trace[i].decisions.filter(d => d.number === n).length === 1) && trace[i].decisions.every(d => Number.isInteger(d.pool) && d.pool >= 1 && d.pool <= 45 &&
      Number.isFinite(d.weight) && d.weight === (trace[i].method === 'uniform' ? 1 : model.weights[d.number]) &&
      Number.isFinite(d.selectionProbability) && d.selectionProbability > 0 && d.selectionProbability <= 1 && Array.isArray(d.influences) &&
      (trace[i].method !== 'uniform' || d.influences.length === 0) && d.influences.every(id => known.get(id)?.number === d.number)));
}

export function chainRecommendationRecord(snapshot, mode = 'evidence') {
  const r = snapshot.result;
  const generated = mode === 'control' ? r.control : r.recommendation;
  return { schema: 1, id: `auto-${snapshot.id}`, source: 'automatic-research', strategy: AUTO_CHAIN_ID, version: AUTO_CHAIN_VERSION,
    generatedAtUTC: snapshot.generatedAtUTC, round: r.model.target, drawDate: r.recommendation.date, seed: r.settings.seed,
    dataRound: r.data.latest, historyFirst: r.data.first, historyCount: r.data.count,
    options: { games: 5, uniqueLines: false, spread: false, mode }, comparable: true,
    lines: generated.lines, research: { kind: 'auto-chain', mode, data: snapshot.data, model: r.model,
      trace: generated.trace, validation: { ...r.validation, rounds: undefined }, search: r.search } };
}

export function chainManualRecord(rows, snapshot, { games, uniqueLines, spread, seed, id, now, mode = 'evidence' }) {
  if (!snapshot || snapshot.result?.version !== AUTO_CHAIN_VERSION || snapshot.data.count !== rows.length ||
    autoHistorySignature(rows) !== snapshot.result.data.signature ||
    rows.reduce((n, row) => Math.max(n, row.round), 0) !== snapshot.data.last) throw Error('최신 자동 분석을 기다려 주세요.');
  if (!['evidence', 'control'].includes(mode)) throw Error('추천/대조군 모드를 확인해 주세요.');
  const record = chainRecommendationRecord(snapshot, mode);
  if (mode === 'evidence' && snapshot.result.recommendation.unavailable) throw Error('점수 분석을 완료하지 못했습니다. 무작위 대조군은 별도로 선택할 수 있습니다.');
  if (now >= new Date(scheduleFor(record.round).cutoffUTC)) throw Error('대상 회차의 생성 시간이 지났습니다. 최신 확정 결과를 확인해 주세요.');
  const generated = mode === 'control' ? generateControlGames(record.round, { games, uniqueLines, spread, seed }) :
    generateChainGames(snapshot.result.model, { games, uniqueLines, spread });
  return { ...record, id, source: 'manual', generatedAtUTC: now.toISOString(), seed, options: { games, uniqueLines, spread, mode },
    comparable: games === 5 && !uniqueLines && !spread && seed === snapshot.result.settings.seed,
    lines: generated.lines, research: { ...record.research, trace: generated.trace } };
}

export function savedAutoRecords(raw) {
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (value?.schema !== 1 || !Array.isArray(value.records) || value.records.length > AUTO_CHAIN_RECORD_LIMIT ||
    value.records.some(r => r?.kind !== 'auto-chain' || !/^[a-f0-9]{64}$/.test(r.id))) throw Error('자동 연구 저장본의 형식 오류: 원본은 보존했습니다.');
  return value.records;
}
export async function saveAutoSnapshot(record, storage, locks = globalThis.navigator?.locks) {
  if (!await verifiedResearch(record)) throw Error('자동 연구 SHA-256 검증 실패');
  const save = async () => {
    const current = savedAutoRecords(storage.getItem(AUTO_CHAIN_KEY));
    for (const existing of current) if (!await verifiedResearch(existing)) throw Error('기존 자동 연구 무결성 오류: 원본은 보존했습니다.');
    if (current.some(r => r.id === record.id)) return;
    const next = [...current, record].slice(-AUTO_CHAIN_RECORD_LIMIT);
    storage.setItem(AUTO_CHAIN_KEY, JSON.stringify({ schema: 1, records: next }));
  };
  return locks ? locks.request(AUTO_CHAIN_KEY, save) : save();
}
