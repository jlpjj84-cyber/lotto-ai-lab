import { bootstrapRoundMean, EXPECTED_MATCHES } from './research-backtest.js';
import { DEFAULT_SEED, hitProbabilities, holm, seededRandom } from './research-math.js';
import { fairDraw, fairNumberSource } from './research-simulation.js';
import { evaluationSchedule, STUDY_VERSION, studyRows, studySettings } from './research-study.js';
import { addDraw, GAMES_PER_DRAW, picksFor, STRATEGIES, STRATEGY_VERSION } from './lotto-strategies.js';

const randomIndex = STRATEGIES.findIndex(([id]) => id === 'random');
const adaptiveIds = new Set(['all-hot', 'hot-30', 'hot-50', 'cold-50', 'overdue', 'pairs']);

function masks(numbers, target, offset = 0) {
  let low = 0, high = 0;
  for (const n of numbers) {
    if (n <= 32) low |= 1 << (n - 1);
    else high |= 1 << (n - 33);
  }
  target[offset] = low;
  target[offset + 1] = high;
}

function encode(tickets, target = new Uint32Array(2 * GAMES_PER_DRAW)) {
  for (let i = 0; i < tickets.length; i++) masks(tickets[i], target, i * 2);
  return target;
}

function popcount(bits) {
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return Math.imul((bits + (bits >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

function scoreMasks(tickets, low, high, frequencies) {
  let total = 0;
  for (let i = 0; i < tickets.length; i += 2) {
    const hit = popcount(low & tickets[i]) + popcount(high & tickets[i + 1]);
    frequencies[hit]++;
    total += hit;
  }
  return total;
}

function copyHistory(history) {
  return { ...history, rows: history.rows.slice(), totals: history.totals.slice(),
    lastSeen: history.lastSeen.slice(), pairs: history.pairs.slice(),
    recent30: history.recent30.slice(), recent50: history.recent50.slice() };
}

function histogramSummary(counts, offset, games, repetitions) {
  let sum = 0, squares = 0, cumulative = 0, lower = null, upper = null;
  const distribution = [];
  counts.forEach((count, i) => {
    if (!count) return;
    const hits = i - offset;
    distribution.push([hits, count]);
    sum += hits * count;
    squares += hits * hits * count;
    cumulative += count;
    if (lower === null && cumulative >= repetitions * .025) lower = hits / games;
    if (upper === null && cumulative >= repetitions * .975) upper = hits / games;
  });
  const average = sum / repetitions;
  const sd = Math.sqrt(Math.max(0, (squares - sum * average) / (repetitions - 1))) / games;
  return { mean: average / games, sd, mcError: sd / Math.sqrt(repetitions),
    min: distribution[0][0] / games, max: distribution.at(-1)[0] / games,
    interval: [lower, upper], distribution };
}

function pairedTail(extreme, repetitions) {
  return (extreme + 1) / (repetitions + 1);
}

export function simulateStrategies(input, progress = () => {}) {
  const { mode = 'fixed', repetitions = 10_000, seed = DEFAULT_SEED,
    strategyIds = STRATEGIES.map(([id]) => id), ...options } = input;
  if (!['fixed', 'adaptive'].includes(mode) || !Number.isInteger(repetitions) || repetitions < 2 || repetitions > 100_000 ||
      !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Array.isArray(strategyIds) || !strategyIds.length ||
      strategyIds.some(id => !STRATEGIES.some(([key]) => key === id))) {
    throw Error('시뮬레이션 방식·시드·반복 횟수·전략을 확인해 주세요.');
  }
  const ids = [...new Set([STRATEGIES[randomIndex][0], ...strategyIds])];
  const indexes = ids.map(id => STRATEGIES.findIndex(([key]) => key === id));
  const rows = studyRows(input.rows);
  const settings = studySettings(rows, options.settings);
  const plan = evaluationSchedule(rows, settings);
  const played = plan.units.filter(({ eligible }) => eligible).map(({ row }) => row.round);
  const games = played.length * GAMES_PER_DRAW;
  if (!games) throw Error('같은 조건에서 평가할 회차가 없습니다. 평가 기간과 직전 연속 50회를 확인해 주세요.');

  const observedHistory = copyHistory(plan.history);
  const actual = ids.map(() => ({ frequencies: Array(7).fill(0), totals: [] }));
  const outcome = new Uint32Array(2);
  for (const [offset, unit] of plan.units.entries()) {
    if (unit.eligible) {
      const { round, numbers } = unit.row;
      masks(numbers, outcome);
      unit.tickets = indexes.map(index => encode(picksFor(observedHistory, round, index)));
      unit.tickets.forEach((tickets, i) => {
        actual[i].totals.push(scoreMasks(tickets, outcome[0], outcome[1], actual[i].frequencies));
      });
    }
    // Retain the outcome only in the historical path. Simulated paths use their own history.
    addDraw(observedHistory, unit.row);
    unit.regenerate = offset !== 0 && mode === 'adaptive';
  }

  const totals = actual.map(row => row.totals.reduce((sum, hits) => sum + hits, 0));
  const limit = games * 6;
  const summary = ids.map(() => ({ hits: Array(7).fill(0), means: new Uint32Array(limit + 1),
    deltas: new Uint32Array(limit * 2 + 1), extremes: 0, sumDelta: 0, checkpoints: [] }));
  const next = fairNumberSource(seed);
  const draw = new Uint8Array(6);
  const buffers = ids.map(() => new Uint32Array(2 * GAMES_PER_DRAW));
  const simulated = new Uint32Array(ids.length);
  const adapts = ids.map(id => adaptiveIds.has(id));
  const useHistory = mode === 'adaptive' && adapts.some(Boolean);
  const checkpointEvery = Math.max(1, Math.ceil(repetitions / 10));

  for (let rep = 1; rep <= repetitions; rep++) {
    const history = useHistory ? copyHistory(plan.history) : null;
    simulated.fill(0);
    for (const unit of plan.units) {
      const { round } = unit.row;
      if (unit.eligible) {
        // Choose all tickets before looking at the outcome for this round.
        for (let i = 0; i < ids.length; i++) {
          if (unit.regenerate && adapts[i]) encode(picksFor(history, round, indexes[i]), buffers[i]);
        }
      }
      fairDraw(next, draw);
      if (unit.eligible) {
        masks(draw, outcome);
        for (let i = 0; i < ids.length; i++) {
          const tickets = unit.regenerate && adapts[i] ? buffers[i] : unit.tickets[i];
          simulated[i] += scoreMasks(tickets, outcome[0], outcome[1], summary[i].hits);
        }
      }
      if (history) addDraw(history, { round, numbers: Array.from(draw) });
    }
    const checkpoint = rep % checkpointEvery === 0 || rep === repetitions;
    for (let i = 0; i < ids.length; i++) {
      const row = summary[i];
      const delta = simulated[i] - simulated[0];
      row.means[simulated[i]]++;
      row.deltas[limit + delta]++;
      row.extremes += delta >= totals[i] - totals[0];
      row.sumDelta += delta;
      if (checkpoint) {
        row.checkpoints.push({ repetitions: rep, deltaMean: row.sumDelta / (rep * games),
          pValue: i && played.length >= 20 ? pairedTail(row.extremes, rep) : null });
      }
    }
    if (checkpoint || rep % 64 === 0) progress(rep, repetitions);
  }

  const pValues = played.length >= 20 ? summary.slice(1).map(row => pairedTail(row.extremes, repetitions)) : [];
  const adjusted = holm(pValues);
  return { mode, repetitions, seed, settings, played, games, exclusions: plan.exclusions,
    modelVersion: STUDY_VERSION, strategyVersion: STRATEGY_VERSION, strategySeed: DEFAULT_SEED,
    theory: { mean: EXPECTED_MATCHES, total: games * EXPECTED_MATCHES, frequencies: hitProbabilities() },
    strategies: ids.map((id, i) => {
      const row = summary[i];
      const real = actual[i];
      return { id, totalHits: totals[i], observedMean: totals[i] / games, observedFrequencies: real.frequencies,
        observedDelta: (totals[i] - totals[0]) / games,
        observedInterval: bootstrapRoundMean(real.totals.map(hits => hits / GAMES_PER_DRAW), seededRandom(seed + i)),
        pValue: pValues[i - 1] ?? null, adjusted: adjusted[i - 1] ?? null,
        frequencies: row.hits, rate3: row.hits.slice(3).reduce((sum, count) => sum + count, 0) / (games * repetitions),
        simulation: histogramSummary(row.means, 0, games, repetitions),
        paired: histogramSummary(row.deltas, limit, games, repetitions), checkpoints: row.checkpoints };
    }),
  };
}
