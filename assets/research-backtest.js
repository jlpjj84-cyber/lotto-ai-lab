import { DEFAULT_SEED, DRAW_SPACE, hitProbabilities, holm, sampleQuantile } from './research-math.js';
import { addDraw, GAMES_PER_DRAW, makePicks, newHistory, randomFor, STRATEGIES, WARMUP } from './lotto-strategies.js';
import { scoreTickets } from './lotto-scoring.js';

export { GAMES_PER_DRAW, STRATEGIES, forecastAt } from './lotto-strategies.js';
export { scoreTickets } from './lotto-scoring.js';
export const DEVELOPMENT_END = 1000;
export const BASELINE_REPETITIONS = 10_000;
export const EXPECTED_MATCHES = 6 * 6 / 45;
const TILTS = [.025, .05, .1, .2, .4, .8, 1.6];

const mgfCache = new Map();

function conditionalLogMgf(tickets) {
  const counts = new Uint8Array(46);
  for (const ticket of tickets) for (const number of ticket) counts[number]++;
  const multiplicities = new Uint8Array(GAMES_PER_DRAW + 1);
  for (let number = 1; number <= 45; number++) multiplicities[counts[number]]++;
  const key = multiplicities.join(',');
  if (mgfCache.has(key)) return mgfCache.get(key);
  const result = TILTS.map(tilt => {
    const sums = new Float64Array(7);
    sums[0] = 1;
    multiplicities.forEach((count, weight) => {
      const factor = Math.exp(tilt * weight / GAMES_PER_DRAW);
      for (let i = 0; i < count; i++) {
        for (let k = 6; k > 0; k--) sums[k] += factor * sums[k - 1];
      }
    });
    return Math.log(sums[6] / DRAW_SPACE);
  });
  mgfCache.set(key, result);
  return result;
}

function emptyScores() {
  return { draws: 0, games: 0, totalHits: 0, hits: Array(7).fill(0), points: [],
    spent: 0, prize: 0, unpriced: 0, logWealth: TILTS.map(() => 0) };
}

function addScore(target, tickets, row, evaluate) {
  const score = scoreTickets(tickets, row);
  target.draws++;
  target.games += tickets.length;
  target.totalHits += score.totalHits;
  score.hits.forEach((count, k) => target.hits[k] += count);
  target.prize += score.prize;
  target.spent += score.spent;
  target.unpriced += score.unpriced;
  if (evaluate) {
    const point = score.totalHits / tickets.length;
    target.points.push(point);
    // Each factor has conditional mean one under a fair draw, even though
    // later tickets adapt to earlier outcomes and the five games can overlap.
    const logMgf = conditionalLogMgf(tickets);
    TILTS.forEach((tilt, i) => target.logWealth[i] += tilt * point - logMgf[i]);
  }
}

function bootstrap(points, random) {
  if (points.length < 20) return null;
  const n = points.length;
  const block = Math.min(10, n);
  const blockTotals = points.map((_, i) => {
    let sum = 0;
    for (let j = 0; j < block; j++) sum += points[(i + j) % n];
    return sum;
  });
  const distribution = new Float64Array(2000);
  for (let rep = 0; rep < distribution.length; rep++) {
    let total = 0;
    for (let offset = 0; offset < n; offset += block) {
      const from = Math.floor(random() * n);
      if (n - offset >= block) total += blockTotals[from];
      else for (let j = 0; j < n - offset; j++) total += points[(from + j) % n];
    }
    distribution[rep] = total / n;
  }
  distribution.sort();
  return [sampleQuantile(distribution, .025), sampleQuantile(distribution, .975)];
}

function summarize(scores, index, evaluation) {
  const { points, logWealth, ...stats } = scores;
  const strongest = Math.max(...logWealth);
  const logMeanWealth = strongest + Math.log(logWealth.reduce((sum, value) => sum + Math.exp(value - strongest), 0) / logWealth.length);
  return {
    ...stats, mean: stats.games ? stats.totalHits / stats.games : null,
    roi: stats.games && !stats.unpriced ? (stats.prize - stats.spent) / stats.spent : null,
    interval: evaluation ? bootstrap(points, randomFor(index + 1, 41)) : null,
    pValue: evaluation && stats.draws >= 20 ? Math.min(1, Math.exp(-logMeanWealth)) : null,
  };
}

export function simulateBaseline(games, repetitions = BASELINE_REPETITIONS) {
  if (!games) return null;
  const probabilities = hitProbabilities();
  const cumulative = probabilities.map((_, i) => probabilities.slice(0, i + 1).reduce((a, b) => a + b, 0));
  const random = randomFor(games, 97);
  const distribution = new Float64Array(repetitions);
  for (let rep = 0; rep < repetitions; rep++) {
    let total = 0;
    for (let i = 0; i < games; i++) {
      const value = random();
      let hits = 0;
      while (hits < 6 && value >= cumulative[hits]) hits++;
      total += hits;
    }
    distribution[rep] = total / games;
  }
  distribution.sort();
  return { repetitions, games, mean: EXPECTED_MATCHES,
    expectedHits: probabilities.map(probability => games * probability),
    interval: [sampleQuantile(distribution, .025), sampleQuantile(distribution, .975)] };
}

export function backtest(rows, progress = () => {}) {
  const history = newHistory();
  const development = STRATEGIES.map(emptyScores);
  const evaluation = STRATEGIES.map(emptyScores);
  const periods = { development: [], evaluation: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (history.contiguous >= WARMUP && row.round === history.lastRound + 1) {
      const evaluate = row.round > DEVELOPMENT_END;
      const scores = evaluate ? evaluation : development;
      periods[evaluate ? 'evaluation' : 'development'].push(row.round);
      makePicks(history, row.round).forEach((tickets, index) => addScore(scores[index], tickets, row, evaluate));
    }
    // Update only after the prediction and scoring of this round are complete.
    addDraw(history, row);
    if ((i + 1) % 64 === 0 || i + 1 === rows.length) progress(i + 1, rows.length);
  }
  const trained = development.map((scores, i) => summarize(scores, i, false));
  const evaluated = evaluation.map((scores, i) => summarize(scores, i, true));
  const comparisons = evaluated.slice(0, -1).map(row => row.pValue);
  const adjusted = comparisons[0] === null ? [] : holm(comparisons);
  return {
    development: periods.development, evaluation: periods.evaluation,
    skipped: rows.length - periods.development.length - periods.evaluation.length,
    baseline: simulateBaseline(evaluated[0].games), seed: DEFAULT_SEED,
    strategies: STRATEGIES.map(([id, label], index) => ({ id, label, development: trained[index],
      evaluation: { ...evaluated[index], adjusted: adjusted[index] ?? null } })),
  };
}
