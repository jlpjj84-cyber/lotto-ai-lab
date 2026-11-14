const assert = require('node:assert/strict');
const { test } = require('node:test');
const { draws } = require('../data/draws.json');

const math = import('../assets/research-math.js');
const patterns = import('../assets/research-patterns.js');
const simulation = import('../assets/research-simulation.js');
const strategies = import('../assets/research-backtest.js');
const ascending = draws.filter(row => row.round <= 1249).sort((a, b) => a.round - b.round);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const sum = values => values.reduce((a, b) => a + b, 0);

test('exact probabilities agree with independent counts and partition the draw space', async () => {
  const { THEORY, PAIRS, TRIPLES } = await patterns;
  const { choose, DRAW_SPACE, hitProbabilities } = await math;
  assert.equal(choose(45, 6), 8_145_060);
  assert.equal(PAIRS.length, 990);
  assert.equal(TRIPLES.length, 14_190);
  for (const distribution of [THEORY.odd, THEORY.sums, THEORY.sumBands, THEORY.runs, THEORY.ends, THEORY.overlap, ...THEORY.bands]) {
    close(sum(distribution), 1);
  }
  close(THEORY.runs[1], choose(40, 6) / DRAW_SPACE);
  close(THEORY.sums[21], 1 / DRAW_SPACE);
  close(THEORY.sums[255], 1 / DRAW_SPACE);
  close(sum(THEORY.sums.map((p, value) => p * value)), 138);
  close(THEORY.odd[3], choose(23, 3) * choose(22, 3) / DRAW_SPACE);
  close(THEORY.overlap[1], 6 * choose(39, 5) / DRAW_SPACE);
  close(THEORY.pair * 990, 15);
  close(THEORY.triple * 14_190, 20);
  assert.deepEqual(hitProbabilities().map(p => Math.round(p * DRAW_SPACE)), [3262623, 3454542, 1233765, 182780, 11115, 234, 1]);
});

test('pattern observations match the frozen 1–1249 archive, excluding bonus numbers', async () => {
  const { observePatterns, selectWindow, matchingRounds } = await patterns;
  const analysis = observePatterns(selectWindow(ascending, 'all'));
  assert.equal(analysis.n, 1249);
  assert.equal(analysis.comparable, 1248);
  const counts = Object.fromEntries(analysis.tests.map(row => [row.id, row.observed]));
  assert.deepEqual(counts, { odd3: 415, sum100: 666, run2: 647, run3: 68, end2: 976, over1: 767, low3: 412,
    maxNumber: 188, minNumber: 137, maxPair: 34, maxTriple: 8, maxGap: 23 });
  assert.deepEqual(analysis.groups.pairs[0].value, [11, 21]);
  assert.equal(sum(analysis.groups.numbers.map(row => row.observed)), 1249 * 6);
  assert.equal(sum(analysis.groups.pairs.map(row => row.observed)), 1249 * 15);
  assert.equal(sum(analysis.groups.triples.map(row => row.observed)), 1249 * 20);
  assert.deepEqual(analysis.analyzed.at(-1).feature.repeated, [16]);
  assert.deepEqual(analysis.analyzed.at(-1).feature.runs, [[34, 35]]);
  assert.equal(matchingRounds(analysis, 'pairs', [11, 21]).length, 34);
  assert.equal(observePatterns(selectWindow(ascending, 20)).comparable, 20);
});

test('gaps skip missing predecessor rounds and expose censored recent intervals', async () => {
  const { observePatterns } = await patterns;
  const rows = [
    { round: 1, numbers: [1, 2, 3, 4, 5, 6] },
    { round: 3, numbers: [2, 3, 4, 5, 6, 7] },
    { round: 4, numbers: [3, 4, 5, 6, 7, 8] },
  ];
  const a = observePatterns({ rows, prior: null });
  assert.equal(a.missing, 1);
  assert.equal(a.comparable, 1);
  assert.equal(a.tailLength, 2);
  assert.deepEqual(a.analyzed.map(row => row.feature.repeated?.length ?? null), [null, null, 5]);
  const n1 = a.groups.gaps.find(row => row.number === 1);
  const n3 = a.groups.gaps.find(row => row.number === 3);
  assert.equal(n1.observed, 2);
  assert.equal(n1.censored, true);
  assert.equal(n1.lastInterval, null);
  assert.equal(n3.lastInterval, 1);
});

test('simulation reproduces seeded runs and tests the 990-pair maximum', async () => {
  const { observePatterns, selectWindow } = await patterns;
  const { simulatePatterns, patternJob } = await simulation;
  const window = selectWindow(ascending, 50);
  const analysis = observePatterns(window);
  const input = patternJob(window, analysis, 1000, 645);
  const first = simulatePatterns(input);
  assert.deepEqual(first, simulatePatterns(input));
  assert.notDeepEqual(first.rows, simulatePatterns({ ...input, seed: 646 }).rows);
  const maxPair = first.rows.find(row => row.id === 'maxPair');
  assert.ok(maxPair.range[0] >= 3 && maxPair.simulatedMean > 4);
  assert.ok(maxPair.simulatedMean > 3 * 50 * (30 / (45 * 44)));
  for (const row of first.rows) assert.ok(row.adjusted >= row.pValue && row.pValue >= 1 / 1001);
});

test('central binomial reference and Holm correction handle discrete tails and dependencies', async () => {
  const { binomialRange, holm } = await math;
  assert.deepEqual(binomialRange(20, .5), [6, 14]);
  assert.deepEqual(binomialRange(1249, 6 / 45), [143, 190]);
  assert.deepEqual(binomialRange(50, 0), [0, 0]);
  assert.deepEqual(holm([.02, .001, .031]), [.04, .003, .04]);
  assert.deepEqual(holm([.02, .001, .031], 8), [.32, .024, .32]);
});

test('all strategies forecast from the same prior window and ignore the draw being predicted', async () => {
  const { forecastAt } = await strategies;
  const original = forecastAt(ascending, 1001);
  const altered = ascending.map(row => row.round < 1001 ? row : { ...row, numbers: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(original, forecastAt(altered, 1001));
  assert.deepEqual(original, forecastAt(ascending.slice(0, 1000), 1001));
  assert.equal(forecastAt(ascending.filter(row => row.round !== 987), 1001), null);
  assert.equal(original.length, 9);
  for (const picks of original) {
    assert.equal(picks.length, 5);
    assert.deepEqual(picks[4], original[0][4]);
    for (const line of picks) assert.equal(new Set(line).size, 6);
  }
});

test('walk-forward totals match replay of one eligible draw and retain fixed periods', async () => {
  const { backtest, forecastAt, scoreTickets } = await strategies;
  const rows = ascending.filter(row => row.round >= 951 && row.round <= 1001);
  const result = backtest(rows);
  const tickets = forecastAt(rows, 1001);
  assert.deepEqual(result.development, []);
  assert.deepEqual(result.evaluation, [1001]);
  assert.equal(result.skipped, 50);
  assert.equal(result.baseline.games, 5);
  assert.equal(result.baseline.repetitions, 10_000);
  result.strategies.forEach((row, index) => {
    const score = scoreTickets(tickets[index], rows.at(-1));
    assert.deepEqual(row.evaluation.hits, score.hits);
    assert.equal(row.evaluation.mean, score.totalHits / 5);
    assert.equal(row.evaluation.spent, 5000);
    assert.equal(row.evaluation.pValue, null);
  });
  const early = backtest(ascending.slice(0, 65));
  assert.equal(early.development[0], 51);
  assert.deepEqual(early.evaluation, []);
  assert.equal(early.baseline, null);
});

test('ROI uses game price at the time, bonus to split five hits, and missing-prize flags', async () => {
  const { scoreTickets } = await strategies;
  const tickets = [[1, 2, 3, 4, 5, 7], [1, 2, 3, 4, 5, 8], [1, 2, 3, 9, 10, 11]];
  const row = { round: 87, numbers: [1, 2, 3, 4, 5, 6], bonus: 7, prizes: { 2: 200, 3: 30 } };
  const result = scoreTickets(tickets, row);
  assert.equal(result.prize, 230);
  assert.equal(result.unpriced, 1);
  assert.equal(result.hits[5], 2);
  assert.equal(result.hits[3], 1);
  assert.equal(result.spent, 6000);
  assert.equal(scoreTickets(tickets, { ...row, round: 88 }).spent, 3000);
});
