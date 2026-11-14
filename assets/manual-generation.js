import { scheduleFor } from './lotto-calendar.js';
import { DEFAULT_SEED } from './research-math.js';
import { generateForStrategy, STRATEGIES, STRATEGY_VERSION } from './lotto-strategies.js';
import { scoreTickets } from './lotto-scoring.js';

export const MANUAL_KEY = 'lotto_lab_v41_generated_records';
const ids = new Set(STRATEGIES.map(([id]) => id));

export function createManualRecord(rows, { strategy, games, uniqueLines, spread, seed, id, now = new Date() }) {
  if (!rows.length || !ids.has(strategy)) throw Error('전략과 추첨 자료를 확인해 주세요.');
  const ordered = rows.slice().sort((a, b) => a.round - b.round);
  const latest = ordered.at(-1).round;
  const round = latest + 1;
  const when = scheduleFor(round);
  if (now >= new Date(when.cutoffUTC)) throw Error('대상 회차의 생성 시간이 지났습니다. 최신 확정 결과를 확인해 주세요.');
  if (now < new Date(`${ordered.at(-1).date}T11:35:00Z`)) throw Error('직전 회차 확정 시각을 확인할 수 없습니다.');
  const generated = generateForStrategy(ordered, round, strategy, { games, uniqueLines, spread, seed });
  if (!generated) throw Error('직전 연속 50회가 필요합니다. 공개 추첨 자료를 갱신해 주세요.');
  return {
    id, schema: 1, source: 'manual', generatedAtUTC: now.toISOString(), round, drawDate: when.date,
    strategy, version: STRATEGY_VERSION, seed, dataRound: generated.latest,
    historyFirst: generated.historyFirst, historyCount: generated.historyCount,
    options: { games, uniqueLines, spread }, comparable: generated.comparable && seed === DEFAULT_SEED,
    lines: generated.lines,
  };
}

export function readManualRecords(raw) {
  if (raw === null) return [];
  const value = JSON.parse(raw);
  const idsSeen = new Set();
  if (value?.schema !== 1 || !Array.isArray(value.records) || !value.records.every(record => {
    if (record?.schema !== 1 || record.source !== 'manual' || typeof record.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(record.id) || idsSeen.has(record.id) || !Number.isInteger(record.round) ||
        record.round < 2 || record.round > 9999 || record.dataRound !== record.round - 1 || !ids.has(record.strategy) ||
        record.drawDate !== scheduleFor(record.round).date || !/^\d+(\.\d+){1,2}$/.test(record.version) ||
        !Number.isFinite(Date.parse(record.generatedAtUTC)) || !Number.isInteger(record.seed) || record.seed < 0 || record.seed > 0xffffffff ||
        !Number.isInteger(record.historyCount) || record.historyCount < 0 || record.historyCount >= record.round ||
        (record.historyCount ? !Number.isInteger(record.historyFirst) || record.historyFirst < 1 || record.historyFirst > record.dataRound : record.historyFirst !== null) ||
        !Number.isInteger(record.options?.games) || record.options.games < 1 || record.options.games > 20 ||
        typeof record.options.uniqueLines !== 'boolean' || typeof record.options.spread !== 'boolean' ||
        typeof record.comparable !== 'boolean' || !Array.isArray(record.lines) || record.lines.length !== record.options.games ||
        !record.lines.every(line => Array.isArray(line) && line.length === 6 && line.every((n, i) =>
          Number.isInteger(n) && n >= 1 && n <= 45 && (i === 0 || n > line[i - 1])))) return false;
    idsSeen.add(record.id);
    return true;
  })) throw Error('이 브라우저의 생성 기록을 읽을 수 없습니다.');
  return value.records;
}

export function manualOutcome(record, draw) {
  if (!draw || draw.round !== record.round) return null;
  const result = scoreTickets(record.lines, draw);
  return { ...result, mean: result.totalHits / record.lines.length };
}
