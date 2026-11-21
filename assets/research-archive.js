import { MANUAL_KEY, readManualRecords } from './manual-generation.js';
import { verifiedResearch } from './research-provenance.js';
import { STRATEGIES } from './lotto-strategies.js';
import { AUTO_CHAIN_ID } from './chain-auto.js';
import { validChainSelection } from './chain-auto-record.js';

export const EXPERIMENT_KEY = 'lotto_lab_v50_strategy_experiments';
const ids = new Set(STRATEGIES.map(([id]) => id));
const finite = value => Number.isFinite(value);
const numeric = list => Array.isArray(list) && list.every(finite);
const validDate = value => typeof value === 'string' && finite(Date.parse(value));
const validId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);

export function readExperiments(raw) {
  if (raw === null) return [];
  const backup = JSON.parse(raw);
  const seen = new Set();
  if (backup?.schema !== 1 || !Array.isArray(backup.records) || !backup.records.every(record => {
    if (!validId(record?.id) || seen.has(record.id) || record.schema !== 1 || !validDate(record.generatedAtUTC) ||
        !['fixed', 'adaptive'].includes(record.result?.mode) || !Number.isInteger(record.result.repetitions) ||
        !Number.isInteger(record.result.seed) || !Number.isInteger(record.result.games) || !numeric(record.result.played) ||
        !/^[0-9a-f]{64}$/.test(record.result.data?.sha256) || !Array.isArray(record.result.strategies) ||
        !record.result.strategies.every(row => ids.has(row?.id) && finite(row.observedMean) && finite(row.observedDelta) &&
          (row.adjusted === null || finite(row.adjusted)))) return false;
    seen.add(record.id);
    return true;
  })) throw Error('저장된 실험 기록의 형식을 확인할 수 없습니다.');
  return backup.records;
}

function validExplanation(record) {
  const evidence = record.research;
  if (!evidence) return !record.sha256;
  if (record.strategy === AUTO_CHAIN_ID) return evidence.kind === 'auto-chain' && /^[0-9a-f]{64}$/.test(evidence.data?.sha256) &&
    evidence.model?.target === record.round && evidence.model.candidates.every(p => p.through === record.dataRound) &&
    validChainSelection(record.lines, evidence.trace, evidence.model);
  const methods = new Set(['uniform', 'hot', 'cold', 'overdue', 'pairs', 'pattern']);
  return /^[0-9a-f]{64}$/.test(evidence.data?.sha256) && finite(evidence.recent) && finite(evidence.earlier) &&
    Array.isArray(evidence.lines) && evidence.lines.length === record.lines.length &&
    evidence.lines.every((line, index) => {
      const features = line?.features;
      return !!features && finite(features.odd) && finite(features.sum) && numeric(features.bands) &&
        Array.isArray(features.runs) && features.runs.every(numeric) &&
        finite(features.maxOverlap) && finite(features.matchingDraws) &&
        Array.isArray(line.reference) && line.reference.length === 6 &&
        line.reference.every(row => row && [row.number, row.recent, row.earlier].every(finite) && (row.gap === null || finite(row.gap))) &&
        methods.has(line.selection?.method) && Array.isArray(line.selection.decisions) &&
        line.selection.decisions.length === 6 && record.lines[index].every(number =>
          line.selection.decisions.filter(decision => decision?.number === number).length === 1) &&
        (line.selection.method !== 'pairs' || line.selection.decisions.every(d => finite(d.partner) || numeric(d.comparedWith)));
    });
}

export async function verifyManual(record) {
  if (!validExplanation(record)) return 'mismatch';
  if (!record.sha256) return record.research ? 'mismatch' : 'legacy';
  return (await verifiedResearch(record)) ? 'verified' : 'mismatch';
}

const config = kind => {
  if (kind === 'recommendations') return { key: MANUAL_KEY, parse: readManualRecords };
  if (kind === 'experiments') return { key: EXPERIMENT_KEY, parse: readExperiments };
  throw Error('지원하는 연구 백업이 아닙니다.');
};

export function exportResearch(kind, storage = localStorage) {
  const { key, parse } = config(kind);
  return { schema: 1, kind, records: parse(storage.getItem(key)) };
}

export async function importResearch(backup, storage = localStorage, locks = globalThis.navigator?.locks) {
  if (backup?.schema !== 1 || !Array.isArray(backup.records)) throw Error('연구 JSON 형식을 확인해 주세요.');
  const { kind } = backup;
  const { key, parse } = config(kind);
  const imported = parse(JSON.stringify({ schema: 1, records: backup.records }));
  for (const item of imported) {
    const valid = kind === 'experiments' ? await verifiedResearch(item) : await verifyManual(item) !== 'mismatch';
    if (!valid) throw Error('기록의 SHA-256이 일치하지 않거나 선정 기록의 형식이 올바르지 않습니다.');
  }
  const merge = () => {
    const current = parse(storage.getItem(key));
    const byId = new Map(current.map(item => [item.id, item]));
    const added = [];
    for (const item of imported) {
      const existing = byId.get(item.id);
      if (existing) {
        const same = item.sha256 ? existing.sha256 === item.sha256 : JSON.stringify(existing) === JSON.stringify(item);
        if (!same) throw Error('같은 ID에 다른 내용의 기록이 있습니다. 원래 기록을 유지했습니다.');
      } else added.push(item);
    }
    if (added.length) storage.setItem(key, JSON.stringify({ schema: 1, records: [...current, ...added] }));
    return added.length;
  };
  return locks ? locks.request(key, merge) : merge();
}
