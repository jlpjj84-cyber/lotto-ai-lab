import './lotto-picks.js';
import { DEFAULT_SEED, DRAW_SPACE, hitProbabilities, holm, sampleQuantile, seededRandom } from './research-math.js';
import { overlap, PAIR_INDEX, PAIRS } from './research-patterns.js';

const WARMUP = 50;
export const DEVELOPMENT_END = 1000;
export const GAMES_PER_DRAW = 5;
export const BASELINE_REPETITIONS = 10_000;
export const EXPECTED_MATCHES = 6 * 6 / 45;
const TILTS = [.025, .05, .1, .2, .4, .8, 1.6];
export const STRATEGIES = Object.freeze([
  ['all-hot', '전체 이력 빈출 가중'], ['hot-30', '최근 30회 빈출 가중'], ['hot-50', '최근 50회 빈출 가중'],
  ['cold-50', '최근 50회 저빈출 가중'], ['overdue', '장기 미출현 우선'], ['pairs', '동시 출현 번호쌍'],
  ['pattern', '홀짝·합계·연속 필터'], ['spread', '수동 4게임 번호 분산'], ['random', '균등 무작위 5게임'],
]);

const { generateManual, uniformLine } = globalThis.LottoPicks;
const allNumbers = Array.from({ length: 45 }, (_, index) => index + 1);
const ordered = numbers => numbers.sort((a, b) => a - b);
const randomFor = (round, offset) => seededRandom(DEFAULT_SEED ^ Math.imul(round, 0x9e3779b1) ^ Math.imul(offset, 0x85ebca6b));

function newHistory() {
  return {
    lastRound: null, contiguous: 0, lastSeen: new Uint16Array(46),
    rows: [], totals: new Uint16Array(46), recent30: new Uint16Array(46),
    recent50: new Uint16Array(46), pairs: new Uint16Array(PAIRS.length),
  };
}

function addDraw(history, row) {
  const { rows, totals, recent30, recent50, lastSeen, pairs } = history;
  const old30 = rows[rows.length - 30];
  const old50 = rows[rows.length - 50];
  if (old30) for (const number of old30.numbers) recent30[number]--;
  if (old50) for (const number of old50.numbers) recent50[number]--;
  row.numbers.forEach((number, i) => {
    totals[number]++;
    recent30[number]++;
    recent50[number]++;
    lastSeen[number] = row.round;
    for (let j = i + 1; j < 6; j++) pairs[PAIR_INDEX[number * 46 + row.numbers[j]]]++;
  });
  rows.push(row);
  history.contiguous = row.round === history.lastRound + 1 ? history.contiguous + 1 : 1;
  history.lastRound = row.round;
}

function pairLines(history, random) {
  const pool = new Set(allNumbers);
  const tie = [0, ...allNumbers.map(() => random())];
  const result = [];
  for (let game = 0; game < 4; game++) {
    let first = 0, second = 0, best = -1, bestTie = -1;
    PAIRS.forEach(([a, b], index) => {
      const count = history.pairs[index];
      const rank = tie[a] + tie[b];
      if (pool.has(a) && pool.has(b) && (count > best || (count === best && rank > bestTie))) {
        first = a; second = b; best = count; bestTie = rank;
      }
    });
    const numbers = [first, second];
    pool.delete(first);
    pool.delete(second);
    while (numbers.length < 6) {
      let pick = 0;
      let strength = -1;
      for (const number of pool) {
        const score = numbers.reduce((sum, other) => sum + history.pairs[
          PAIR_INDEX[Math.min(number, other) * 46 + Math.max(number, other)]], 0);
        if (score > strength || (score === strength && tie[number] > tie[pick])) {
          strength = score;
          pick = number;
        }
      }
      numbers.push(pick);
      pool.delete(pick);
    }
    result.push(ordered(numbers));
  }
  return result;
}

function patternLines(random) {
  const result = [];
  const seen = new Set();
  // Fixed before evaluation: 3 odds, sum 100–149, at least one adjacent pair.
  for (let attempt = 0; attempt < 2048 && result.length < 4; attempt++) {
    const line = uniformLine(random);
    const key = line.join(',');
    const sum = line.reduce((total, number) => total + number, 0);
    const odds = line.reduce((total, number) => total + (number & 1), 0);
    if (odds === 3 && sum >= 100 && sum <= 149 && !seen.has(key) && line.some((number, i) => number === line[i - 1] + 1)) {
      seen.add(key);
      result.push(line);
    }
  }
  if (result.length !== 4) throw Error('고정 패턴을 만족하는 4게임을 구성하지 못했습니다.');
  return result;
}

function makePicks(history, round) {
  const common = uniformLine(randomFor(round, 1));
  return STRATEGIES.map(([id], index) => {
    const random = randomFor(round, index + 2);
    let manual;
    if (id === 'overdue') {
      const tailStart = history.lastRound - history.contiguous + 1;
      const age = number => history.lastRound - Math.max(tailStart - 1, history.lastSeen[number]);
      const ranked = allNumbers.map(number => ({ number, age: age(number), tie: random() }))
        .sort((a, b) => b.age - a.age || a.tie - b.tie).map(item => item.number);
      manual = Array.from({ length: 4 }, (_, i) => ordered(ranked.slice(i * 6, i * 6 + 6)));
    } else if (id === 'pairs') {
      manual = pairLines(history, random);
    } else if (id === 'pattern') {
      manual = patternLines(random);
    } else {
      const counts = id === 'all-hot' ? history.totals : id === 'hot-30' ? history.recent30 : history.recent50;
      const mode = id.endsWith('hot') || id.startsWith('hot-') ? 'hot' : id === 'cold-50' ? 'cold' : id;
      manual = generateManual({ mode, unique: id !== 'random', counts, random });
    }
    return [...manual, common];
  });
}

export function forecastAt(rows, round) {
  const history = newHistory();
  for (const row of rows) {
    if (row.round >= round) break;
    addDraw(history, row);
  }
  return history.contiguous >= WARMUP && history.lastRound === round - 1 ? makePicks(history, round) : null;
}

export function scoreTickets(tickets, row) {
  const hits = Array(7).fill(0);
  let prize = 0, unpriced = 0, totalHits = 0;
  for (const ticket of tickets) {
    const count = overlap(ticket, row.numbers);
    hits[count]++;
    totalHits += count;
    const rank = count === 6 ? 1 : count === 5 ? (ticket.includes(row.bonus) ? 2 : 3) : count === 4 ? 4 : count === 3 ? 5 : 0;
    if (!rank) continue;
    const amount = row.prizes?.[rank];
    if (Number.isSafeInteger(amount) && amount > 0) prize += amount;
    else unpriced++;
  }
  // The game price was halved starting with draw 88 (2004-08-07).
  return { hits, totalHits, prize, unpriced, spent: tickets.length * (row.round >= 88 ? 1000 : 2000) };
}

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
