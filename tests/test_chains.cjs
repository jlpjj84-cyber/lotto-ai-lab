const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { draws } = require('../data/draws.json');
const core = import('../assets/chain-research.js');
const math = import('../assets/chain-math.js');
const validation = import('../assets/chain-validation.js');
const actual = draws.filter(row => row.round <= 1250).sort((a, b) => a.round - b.round);
const synthetic = (n, numbers = [1, 2, 3, 4, 5, 6]) => Array.from({ length: n }, (_, i) => ({ round: i + 1, numbers }));
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('chain probabilities use all six main numbers, exact set inclusion and real round gaps', async () => {
  const { compileChain, rowIndex, observeChain, transitionMatrix } = await core;
  const { inclusionProbability } = await math;
  const rows = [{ round: 1, numbers: [1, 2, 3, 4, 5, 6], bonus: 45 },
    { round: 2, numbers: [7, 8, 9, 10, 11, 12] }, { round: 3, numbers: [1, 8, 13, 14, 15, 16] },
    { round: 5, numbers: [1, 8, 17, 18, 19, 20] }];
  close(inclusionProbability(2), 1 / 66);
  close(inclusionProbability(6), 1 / 8145060);
  const chain = compileChain([[1, 2], [8]], [1]);
  const observation = observeChain(rowIndex(rows), chain, 1, 5);
  assert.equal(observation.windows, 2);
  assert.equal(observation.trials, 1);
  assert.equal(observation.successes, 1);
  close(observation.expected, 2 / 66 * 6 / 45);
  assert.deepEqual(observation.occurrences[0].rounds, [1, 2]);
  const lag2 = observeChain(rowIndex(rows), compileChain([[1], [8]], [2]), 1, 5);
  assert.equal(lag2.windows, 2); assert.equal(lag2.successes, 2);
  const matrix = transitionMatrix(rows, 1, 1, 5);
  assert.equal(matrix.windows, 2);
  assert.equal(matrix.counts[44 * 45 + 7], 0); // bonus is never a source
  assert.equal(matrix.counts[0 * 45 + 7], 1);
  assert.equal(matrix.counts.reduce((a, b) => a + b), 2 * 36);
});

test('observed prefix mining matches exhaustive small fixtures and supports eleven stages', async () => {
  const { discoverChains, compileChain, rowIndex, observeChain } = await core;
  const rows = synthetic(18), options = { developmentEnd: 18, endRound: 19, maxLength: 11, minSupport: 3, topK: 30, maxNodes: 500000 };
  // Restrict a long path through custom sets without expanding a Cartesian product.
  const chain = compileChain(Array(11).fill([1, 2, 3, 4, 5, 6]), Array(10).fill(1));
  assert.equal(observeChain(rowIndex(rows), chain, 1, 18).successes, 8);
  const varied = Array.from({ length: 80 }, (_, i) => ({ round: i + 1,
    numbers: i % 2 ? [1, 2, 3, 4, 5, 7] : [1, 2, 3, 4, 5, 6] }));
  const discovered = discoverChains(varied, { ...options, developmentEnd: 80, endRound: 81, maxLength: 2 });
  for (const candidate of discovered.candidates) {
    const observed = observeChain(rowIndex(varied), candidate.chain, 1, 80);
    assert.equal(candidate.trainingSuccesses, observed.successes);
    assert.equal(candidate.trainingTrials, observed.trials);
  }
  const long = discoverChains(rows, { ...options, maxNodes: 200 });
  assert.equal(long.partial, true); assert.match(long.reason, /예산/);
  assert.equal(long.requestedLength, 11);
  const limited = discoverChains(rows, { ...options, maxLength: 100, gap: 10, minSupport: 10 });
  assert.equal(limited.effectiveLength, 2);
  assert.ok(limited.deepest <= 2);
});

test('long chains are not artificially capped at five or ten when observed support survives', async () => {
  const { discoverChains } = await core;
  // Only one number persists; the other five numbers rotate to avoid a 6^L tree.
  const rows = Array.from({ length: 140 }, (_, i) => ({ round: i + 1,
    numbers: [1, ...Array.from({ length: 5 }, (_, j) => 2 + ((i * 5 + j) % 44))].sort((a, b) => a - b) }));
  const result = discoverChains(rows, { developmentEnd: 140, endRound: 141, maxLength: 11, minSupport: 100, topK: 12 });
  assert.equal(result.deepest, 11);
  assert.ok(result.candidates.some(item => item.chain.stages.length === 11));
  assert.equal(result.partial, false);
});

test('input validation rejects duplicate or malformed draws; set queries retain irregular gaps', async () => {
  const { cleanChainRows, parseChain, chainSettings } = await core;
  assert.throws(() => cleanChainRows([...synthetic(1), ...synthetic(1)]), /중복/);
  assert.throws(() => cleanChainRows([{ round: 1, numbers: [1, 1, 3, 4, 5, 6] }]), /검증 실패/);
  assert.throws(() => cleanChainRows([]), /확정 회차/);
  assert.throws(() => parseChain('1 / 46'), /본번호/);
  assert.throws(() => parseChain('1 / 2 / 3', 1, '2'), /간격 수/);
  assert.deepEqual(parseChain('1,2 / 3 / 4,5', 1, '2,10').offsets, [0, 2, 12]);
  assert.throws(() => chainSettings({ developmentEnd: 1000, endRound: 900 }), /평가 구간/);
});

test('mixture test has mean one with overlapping predictable triggers under the fair null', async () => {
  const { bernoulliLogE, conditionalInterval } = await math;
  const p = 6 / 45;
  let expectation = 0;
  for (let bits = 0; bits < 256; bits++) {
    let trials = 0, successes = 0, ones = 0;
    for (let t = 0; t < 8; t++) {
      const hit = (bits >> t) & 1; ones += hit;
      if (t && ((bits >> (t - 1)) & 1)) { trials++; successes += hit; }
    }
    expectation += p ** ones * (1 - p) ** (8 - ones) * Math.exp(bernoulliLogE(successes, trials, p));
  }
  close(expectation, 1);
  for (const [successes, n] of [[0, 20], [5, 20], [20, 20], [14, 100]]) {
    const interval = conditionalInterval(successes, n);
    assert.ok(interval[0] <= successes / n && interval[1] >= successes / n);
    for (const boundary of interval) if (boundary > 1e-10 && boundary < 1 - 1e-10) close(bernoulliLogE(successes, n, boundary), -Math.log(.05), 1e-8);
  }
  assert.deepEqual(conditionalInterval(0, 0), [0, 1]);
});

test('round-paired exact MGF agrees with independent combinatorial enumeration', async () => {
  const { pairedLogMgfs, FORECAST_TILTS } = await math;
  const { choose, DRAW_SPACE } = await import('../assets/research-math.js');
  const a = Array(5).fill([1, 2, 3, 4, 5, 6]), b = Array(5).fill([7, 8, 9, 10, 11, 12]);
  const mgfs = pairedLogMgfs(a, b);
  FORECAST_TILTS.forEach((tilt, i) => {
    let total = 0;
    for (let x = 0; x <= 6; x++) for (let y = 0; y <= 6 - x; y++) {
      total += choose(6, x) * choose(6, y) * choose(33, 6 - x - y) * Math.exp(tilt * (x - y));
    }
    close(mgfs[i], Math.log(total / DRAW_SPACE));
  });
  for (const value of pairedLogMgfs(a, a)) close(value, 0);
});

test('discovery ignores all future draws and fixed/walk-forward forecasts use strictly earlier information', async () => {
  const { analyzeChains } = await core;
  const original = analyzeChains(actual);
  const changed = actual.map(row => row.round >= 1200 ? { ...row, numbers: [1, 2, 3, 4, 5, 6] } : row);
  const alternative = analyzeChains(changed);
  assert.deepEqual(original.discovery, alternative.discovery);
  assert.deepEqual(original.patterns.map(p => p.discovery), alternative.patterns.map(p => p.discovery));
  const through = (a, round) => a.forecast.rounds.filter(r => r.round <= round).map(r => r.tickets);
  assert.deepEqual(through(original, 1200), through(alternative, 1200));
  const walk = analyzeChains(actual, { mode: 'walk-forward' });
  const walkChanged = analyzeChains(changed, { mode: 'walk-forward' });
  assert.deepEqual(through(walk, 1200), through(walkChanged, 1200));
  for (const result of [original, walk]) {
    assert.equal(result.forecast.n, 250); assert.equal(result.forecast.games, 1250);
    for (const round of result.forecast.rounds) {
      assert.equal(round.priorEnd, round.round - 1); assert.ok(round.fittedThrough < round.round);
      assert.equal(round.tickets.length, 5); assert.equal(round.baseline.length, 5);
      assert.deepEqual(round.tickets[4], round.baseline[4]);
      for (const line of round.tickets) { assert.equal(new Set(line).size, 6); assert.ok(line.every(n => n >= 1 && n <= 45)); }
    }
  }
});

test('inactive experimental predictor exactly reproduces the existing uniform five-game baseline', async () => {
  const { evaluateChainForecast, chainSettings } = await core;
  const result = evaluateChainForecast(actual, [], chainSettings());
  assert.equal(result.difference, 0);
  assert.equal(result.activeRounds, 0);
  for (const row of result.rounds) assert.deepEqual(row.tickets, row.baseline);
  assert.equal(result.adjustedP, 1);
});

test('Monte Carlo is seeded, preserves family size, includes the whole-family maximum and blocks unrealistic work', async () => {
  const { analyzeChains } = await core;
  const { validateChains } = await validation;
  const analysis = analyzeChains(actual, { topK: 3 });
  const first = validateChains(actual, analysis, 40), second = validateChains(actual, analysis, 40);
  assert.deepEqual(first.patterns, second.patterns);
  assert.equal(first.patterns.length, 3);
  first.patterns.forEach(p => {
    assert.ok(p.familyP >= p.pValue && p.adjustedP >= p.pValue);
    assert.ok(p.pValue >= 1 / 41); assert.equal(p.verdict, '표본 부족');
    assert.ok(p.statisticRange.length === 2);
  });
  const anotherSeed = validateChains(actual, { ...analysis, settings: { ...analysis.settings, seed: 1 } }, 40);
  assert.notDeepEqual(first.patterns, anotherSeed.patterns);
  assert.throws(() => validateChains(actual, analyzeChains(actual), 100000), /안전 한도/);
  const corrupted = structuredClone(analysis);
  corrupted.patterns[0].chain.span++;
  assert.throws(() => validateChains(actual, corrupted, 40), /무결성/);
  const mismatched = structuredClone(analysis);
  mismatched.patterns[0].evaluation.successes++;
  assert.throws(() => validateChains(actual, mismatched, 40), /일치하지/);
});

test('missing target and precursor draws are excluded explicitly and tiny samples are not declared successful', async () => {
  const { analyzeChains } = await core;
  const result = analyzeChains(actual.filter(r => r.round !== 1005 && r.round !== 1010));
  assert.equal(result.data.missing, 2);
  assert.ok(result.forecast.skipped >= 2);
  assert.ok(result.forecast.n < 248);
  const tiny = analyzeChains(actual, { developmentEnd: 1248, endRound: 1250 });
  assert.equal(tiny.forecast.interval, null); assert.equal(tiny.forecast.adjustedP, null);
  assert.equal(tiny.forecast.verdict, '표본 부족');
  const pending = analyzeChains(actual, { endRound: 1260 });
  assert.equal(pending.data.pending, 10); assert.equal(pending.forecast.n, 250);
  assert.ok(pending.forecast.rounds.every(row => row.round <= 1250));
});

test('transition evaluation includes known boundary context and matches direct conditional counts', async () => {
  const { transitionMatrix, compileChain, observeChain, rowIndex } = await core;
  const matrix = transitionMatrix(actual, 10, 1001, 1250);
  const conditional = observeChain(rowIndex(actual), compileChain([[20], [18]], [10]), 1001, 1250);
  assert.equal(matrix.windows, 250);
  assert.equal(matrix.trials[19], conditional.trials);
  assert.equal(matrix.counts[19 * 45 + 17], conditional.successes);
});

test('five past complete-number sets and future distributions stay separate across the split', async () => {
  const { compileChain, rowIndex, observeChain } = await core;
  const rows = synthetic(30), chain = compileChain(Array(5).fill([1, 2, 3, 4, 5, 6]), Array(4).fill(1));
  const discovery = observeChain(rowIndex(rows), chain, 1, 20);
  const evaluation = observeChain(rowIndex(rows), chain, 21, 30);
  assert.equal(discovery.successes, 16); assert.equal(discovery.next.trials, 15);
  assert.equal(evaluation.successes, 10); assert.equal(evaluation.next.trials, 9);
  assert.equal(discovery.next.counts[0], 15); assert.equal(discovery.next.counts[6], 0);
  assert.ok(discovery.next.rounds.every(round => round <= 20));
});

test('dedicated chain worker reports progress, handles errors, and can be terminated without a result', async t => {
  const script = pathToFileURL(join(__dirname, '../assets/chain-worker.js')).href;
  const harness = `import {parentPort} from 'node:worker_threads'; globalThis.self={addEventListener:(e,cb)=>parentPort.on('message',data=>cb({data})),postMessage:m=>parentPort.postMessage(m)};await import(${JSON.stringify(script)});`;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(harness)));
  t.after(() => worker.terminate());
  const messages = [];
  const wait = () => new Promise((resolve, reject) => {
    const listener = message => { messages.push(message); if (message.result || message.error) { worker.off('message', listener); resolve(message); } };
    worker.on('message', listener); worker.once('error', reject);
  });
  let pending = wait(); worker.postMessage({ kind: 'chains', job: { rows: actual, settings: { topK: 3 } } });
  const { result } = await pending;
  assert.equal(result.forecast.n, 250); assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
  assert.ok(messages.some(message => message.progress === 1));
  pending = wait(); worker.postMessage({ kind: 'unsupported', job: { rows: actual } });
  assert.match((await pending).error, /알 수 없는/);
  let completed = false;
  worker.on('message', message => { if (message.result) completed = true; });
  worker.postMessage({ kind: 'chain-simulation', job: { rows: actual, analysis: result, repetitions: 100000 } });
  await new Promise(resolve => setTimeout(resolve, 15));
  await worker.terminate();
  assert.equal(completed, false);
});
