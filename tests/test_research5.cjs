const assert = require('node:assert/strict');
const { test } = require('node:test');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const { draws } = require('../data/draws.json');
const frozenPrediction = require('../data/predictions/1250.json');

const strategies = import('../assets/lotto-strategies.js');
const study = import('../assets/research-backtest.js');
const monteCarlo = import('../assets/strategy-simulation.js');
const provenance = import('../assets/research-provenance.js');
const archive = import('../assets/research-archive.js');
const manual = import('../assets/manual-generation.js');
const evidence = import('../assets/selection-evidence.js');
const rows = draws.filter(row => row.round <= 1250).sort((a, b) => a.round - b.round);
const before1250 = rows.filter(row => row.round < 1250);
const settings = { trainStart: 1150, developmentEnd: 1229, evalStart: 1231, evalEnd: 1250 };
const sum = values => values.reduce((a, b) => a + b, 0);

test('250 rounds count one or five complete six-number tickets with the correct expectations', async () => {
  const { backtest, EXPECTED_MATCHES } = await study;
  const result = backtest(rows);
  assert.equal(EXPECTED_MATCHES, 6 * 6 / 45);
  assert.equal(result.evaluation.length, 250);
  assert.equal(result.evaluation.length * EXPECTED_MATCHES, 200);
  assert.equal(result.baseline.games, 1250);
  assert.equal(result.baseline.expectedTotalHits, 1000);
  assert.deepEqual(result.exclusions, []);
  assert.deepEqual(result.strategies.map(strategy => strategy.evaluation.totalHits), [973, 964, 975, 944, 1010, 1007, 990, 946, 997]);
});

test('exact fair generator never repeats a number and agrees with theory at 100,000 draws', async () => {
  const { fairDraw, fairNumberSource } = await import('../assets/research-simulation.js');
  const { hitProbabilities } = await import('../assets/research-math.js');
  const next = fairNumberSource(645);
  const counts = Array(7).fill(0);
  const selected = new Uint8Array(6);
  for (let i = 0; i < 100_000; i++) {
    fairDraw(next, selected);
    assert.ok(selected[0] >= 1 && selected[5] <= 45 && selected.every((n, k) => k === 0 || n > selected[k - 1]));
    counts[selected.filter(n => n <= 6).length]++;
  }
  hitProbabilities().forEach((p, k) => assert.ok(Math.abs(counts[k] / 100_000 - p) < .005));
  assert.ok(Math.abs(sum(counts.map((n, k) => n * k)) / 100_000 - .8) < .01);
});

test('a 10,000-repeat paired run matches backtest outcomes and preserves equal sample sizes', async () => {
  const { simulateStrategies } = await monteCarlo;
  const real = (await study).backtest(rows, undefined, settings);
  const updates = [];
  const args = { rows, settings, repetitions: 10_000, seed: 1234 };
  const result = simulateStrategies(args, (n, total) => updates.push([n, total]));
  assert.deepEqual(result, simulateStrategies(args));
  assert.equal(result.games, 100);
  assert.deepEqual(result.played, real.evaluation);
  assert.equal(result.theory.total, 80);
  assert.deepEqual(updates.at(-1), [10_000, 10_000]);
  const base = result.strategies[0];
  assert.deepEqual(base.paired.distribution, [[0, 10_000]]);
  for (const strategy of result.strategies) {
    assert.deepEqual(strategy.observedFrequencies, real.strategies.find(s => s.id === strategy.id).evaluation.hits);
    assert.equal(sum(strategy.frequencies), result.games * result.repetitions);
    assert.ok(Math.abs(strategy.simulation.mean - .8) < .008);
    assert.equal(strategy.observedDelta, (strategy.totalHits - base.totalHits) / result.games);
    assert.ok(strategy.pValue === null || strategy.adjusted >= strategy.pValue);
    assert.ok(strategy.observedInterval[0] <= strategy.observedMean && strategy.observedMean <= strategy.observedInterval[1]);
    assert.equal(strategy.checkpoints.at(-1).repetitions, result.repetitions);
  }
  assert.notDeepEqual(result.strategies[0].simulation, simulateStrategies({ ...args, repetitions: 1000, seed: 1235 }).strategies[0].simulation);
  assert.throws(() => simulateStrategies({ ...args, seed: -1 }), /시드/);
});

test('adaptive null uses synthetic prior draws and ignores real evaluation outcomes', async () => {
  const { simulateStrategies } = await monteCarlo;
  const local = { ...settings, evalStart: 1247, window: 50 };
  const futureChanged = rows.map(row => row.round >= 1247 ? { ...row, numbers: [1, 2, 3, 4, 5, 6] } : row);
  const args = { rows, settings: local, repetitions: 64, mode: 'adaptive', strategyIds: ['all-hot', 'pairs'] };
  const first = simulateStrategies(args);
  const changed = simulateStrategies({ ...args, rows: futureChanged });
  for (let i = 0; i < first.strategies.length; i++) {
    assert.deepEqual(first.strategies[i].simulation, changed.strategies[i].simulation);
    assert.deepEqual(first.strategies[i].paired, changed.strategies[i].paired);
    assert.equal(first.strategies[i].pValue, null);
  }
  const fixed = simulateStrategies({ ...args, mode: 'fixed' });
  assert.notDeepEqual(first.strategies[1].simulation, fixed.strategies[1].simulation);
  assert.notDeepEqual(first.strategies.map(row => row.totalHits), changed.strategies.map(row => row.totalHits));
});

test('rolling predictions match fresh prior windows; missing draw exclusions are explicit', async () => {
  const { backtest, scoreTickets } = await study;
  const { forecastAt } = await strategies;
  const opts = { ...settings, window: 50 };
  const result = backtest(rows, undefined, opts);
  for (const item of result.timeline) {
    const actual = rows.find(row => row.round === item.round);
    const past = rows.filter(row => row.round >= item.round - 50 && row.round < item.round);
    assert.deepEqual(item.hits, forecastAt(past, actual.round).map(games => scoreTickets(games, actual).totalHits));
  }
  const gap = backtest(rows.filter(r => r.round !== 1249), undefined, opts);
  assert.deepEqual(gap.exclusions, [{ round: 1249, reason: 'missing-result' },
    { round: 1250, reason: 'insufficient-contiguous-history' }]);
  assert.ok(gap.development.every(r => r <= opts.developmentEnd));
  assert.ok(gap.evaluation.every(r => r >= opts.evalStart));
  assert.equal(gap.timeline.length, 18);
});

test('all nine strategies retain the recorded production lines and trace the actual selections', async () => {
  const { generateForStrategy } = await strategies;
  const { explainSelections, reasonFor } = await evidence;
  for (const saved of frozenPrediction.strategies) {
    const generated = generateForStrategy(before1250, 1250, saved.id, { explain: true });
    assert.deepEqual(generated.lines, saved.games);
    assert.deepEqual(generated.trace.map(line => line.decisions.map(row => row.number).sort((a, b) => a - b)), saved.games);
    assert.equal(generated.trace[4].shared, true);
    const summary = explainSelections(rows, 1250, generated);
    assert.equal(summary.recent, 50);
    assert.equal(summary.earlier, 1199);
    assert.equal(summary.lines[0].features.sum, sum(saved.games[0]));
    assert.match(reasonFor(summary.lines[4].selection, saved.games[4][0]), /공통 무작위/);
    const rule = generated.trace[0];
    if (saved.id === 'hot-30') {
      const chosen = rule.decisions[0];
      assert.equal(chosen.count, before1250.slice(-30).filter(r => r.numbers.includes(chosen.number)).length);
      assert.equal(chosen.weight, (chosen.count + 2) ** 2);
      assert.equal(chosen.pool, 45);
    }
    if (saved.id === 'pairs') {
      const [chosen, second, third] = rule.decisions;
      assert.equal(chosen.count, before1250.filter(r => r.numbers.includes(chosen.number) && r.numbers.includes(second.number)).length);
      assert.equal(third.score, sum(third.comparedWith.map(other =>
        before1250.filter(r => r.numbers.includes(third.number) && r.numbers.includes(other)).length)));
    }
    if (saved.id === 'pattern') {
      assert.equal(summary.lines[0].features.odd, 3);
      assert.ok(summary.lines[0].features.runs.length > 0);
    }
    if (saved.id === 'random' || saved.id === 'spread') assert.equal(rule.method, 'uniform');
  }
});

test('research storage round trips and refuses altered evidence without replacing saved recommendations', async () => {
  const { createManualRecord } = await manual;
  const { datasetStamp, sealResearch, verifiedResearch } = await provenance;
  const { exportResearch, importResearch, verifyManual } = await archive;
  const stored = new Map([['lotto_lab_v3_private_records', 'unchanged']]);
  const storage = { getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { stored.set(key, value); } };
  const options = { strategy: 'hot-30', now: new Date('2026-11-14T09:00:00Z'), games: 5,
    uniqueLines: false, spread: false, seed: 645, id: 'legacy' };
  const legacy = createManualRecord(before1250, options);
  const draft = createManualRecord(before1250, { ...options, id: 'sealed', explain: true });
  draft.research.data = await datasetStamp(before1250);
  const record = await sealResearch(draft);
  assert.equal(await verifyManual(legacy), 'legacy');
  assert.equal(await verifyManual(record), 'verified');
  assert.equal(await verifyManual(draft), 'mismatch');
  const backup = { schema: 1, kind: 'recommendations', records: [legacy, record] };
  assert.equal(await importResearch(backup, storage), 2);
  assert.deepEqual(exportResearch('recommendations', storage), backup);
  assert.equal(await importResearch(backup, storage), 0);
  const altered = structuredClone(record);
  altered.research.lines[0].features.sum++;
  assert.equal(await verifiedResearch(altered), false);
  await assert.rejects(importResearch({ ...backup, records: [altered] }, storage), /SHA-256/);
  await assert.rejects(importResearch({ ...backup, records: [await sealResearch(altered)] }, storage), /같은 ID/);
  assert.deepEqual(exportResearch('recommendations', storage), backup);
  const result = (await monteCarlo).simulateStrategies({ rows, settings, repetitions: 10, strategyIds: ['all-hot'] });
  result.data = await datasetStamp(rows);
  const experiment = await sealResearch({ id: 'exp-a', schema: 1, generatedAtUTC: new Date().toISOString(), result });
  const experiments = { schema: 1, kind: 'experiments', records: [experiment] };
  assert.equal(await importResearch(experiments, storage), 1);
  assert.deepEqual(exportResearch('experiments', storage), experiments);
  assert.equal(stored.get('lotto_lab_v3_private_records'), 'unchanged');
});

test('future GitHub records include replayable evidence; legacy records keep their original schema', async () => {
  const { createPrediction, verifyPrediction } = await import('../scripts/live-core.mjs');
  const bytes = Buffer.from(JSON.stringify({ draws: before1250 }));
  const input = [bytes, new Date('2026-11-14T09:00:00Z'), before1250.at(-1), '1234'];
  const previous = createPrediction(...input, { schema: 1 });
  const current = createPrediction(...input);
  assert.equal(current.schema, 2);
  assert.equal(previous.strategies[0].research, undefined);
  assert.deepEqual(current.strategies.map(s => s.games), previous.strategies.map(s => s.games));
  assert.equal(current.strategies[0].research.validation.backtest.last, 1249);
  assert.equal(current.strategies[0].research.validation.monteCarlo, null);
  assert.deepEqual(verifyPrediction(previous, bytes), previous);
  assert.deepEqual(verifyPrediction(current, bytes), current);
});

test('the browser worker protocol posts progress and results while the caller remains responsive', async t => {
  const workerScript = pathToFileURL(join(__dirname, '../assets/research-worker.js')).href;
  const workerHarness = `
    import { parentPort } from 'node:worker_threads';
    globalThis.self = {
      addEventListener(event, callback) { parentPort.on('message', data => callback({ data })); },
      postMessage: message => parentPort.postMessage(message),
    };
    await import(${JSON.stringify(workerScript)});
  `;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(workerHarness)));
  t.after(() => worker.terminate());
  const progress = [];
  const result = new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', message => {
      if (message.error) reject(Error(message.error));
      if (message.progress !== undefined) progress.push(message.progress);
      if (message.result) resolve(message.result);
    });
  });
  worker.postMessage({ kind: 'strategy-simulation', job: { rows, settings, repetitions: 10_000 } });
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 5);
  t.after(() => clearInterval(timer));
  const run = await result;
  assert.ok(ticks > 0);
  assert.equal(progress.at(-1), 1);
  assert.match(run.data.sha256, /^[a-f0-9]{64}$/);
  assert.equal(run.repetitions, 10_000);
});
