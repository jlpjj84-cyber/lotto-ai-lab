const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { draws } = require('../data/draws.json');
const core = import('../assets/chain-auto.js');
const records = import('../assets/chain-auto-record.js');
const rows = draws.filter(r => r.round <= 1251).sort((a, b) => a.round - b.round);
const now = new Date('2026-11-22T02:00:00Z');
const smallOptions = { maxLag: 2, maxLength: 4, evaluationStart: 51, maxModels: 3000, beam: 3 };
const shortRows = rows.slice(0, 120);
const result = core.then(c => c.automaticChainAnalysis(rows));

test('all published draws feed the next recommendation and the user catalog has exactly ten strategies', async () => {
  const r = await result;
  assert.deepEqual(r.data.count, 1251); assert.equal(r.model.target, 1252);
  assert.equal(r.validation.n, 251); assert.equal(r.validation.games, 1255);
  for (const row of r.validation.rounds) assert.deepEqual(row.experimental[4], row.baseline[4]);
  assert.equal(r.recommendation.lines.length, 5); assert.equal(r.model.fallback, false);
  const { RECOMMENDATION_STRATEGIES } = await import('../assets/strategy-catalog.js');
  const { STRATEGIES, forecastAt } = await import('../assets/lotto-strategies.js');
  assert.equal(RECOMMENDATION_STRATEGIES.length, 10); assert.deepEqual(RECOMMENDATION_STRATEGIES.slice(0, 9), STRATEGIES);
  assert.equal(RECOMMENDATION_STRATEGIES[9][0], 'chain-experiment');
  const original = require('../data/predictions/1250.json');
  assert.deepEqual(forecastAt(rows.filter(r => r.round < 1250), 1250), original.strategies.map(s => s.games));
});

test('automatic discovery covers transitions, mixed temporal gaps and simultaneous-number conditions', async () => {
  const r = await result;
  assert.ok(r.model.candidates.some(p => p.context.stages.length === 1 && p.context.stages[0].length === 1));
  assert.ok(r.model.candidates.some(p => p.context.stages[0].length === 2));
  assert.ok(r.model.candidates.some(p => p.context.lags.length > 1 && p.context.lags[0] - p.context.lags[1] !== p.context.lags[1]));
  assert.ok(r.search.limits.deepest >= 4);
  for (const p of r.model.candidates) {
    const matching = rows.filter(row => p.context.lags.every((lag, i) => {
      const past = rows.find(r => r.round === row.round - lag);
      return past && p.context.stages[i].every(n => past.numbers.includes(n));
    }));
    assert.equal(p.trials, matching.length); assert.equal(p.successes, matching.filter(row => row.numbers.includes(p.number)).length);
    assert.equal(p.through, 1251); assert.ok(p.validation.registeredAt <= 1252);
    assert.deepEqual(p.targets, matching.map(r => r.round));
  }
});

test('future outcomes never alter a prior prediction; the same prefix reproduces the actual next strategy', async () => {
  const { automaticChainAnalysis } = await core;
  const original = automaticChainAnalysis(shortRows, smallOptions);
  const changed = shortRows.map(r => r.round >= 100 ? { ...r, numbers: [1, 2, 3, 4, 5, 6] } : r);
  const alternative = automaticChainAnalysis(changed, smallOptions);
  const through = r => r.validation.rounds.filter(p => p.round <= 100).map(p => [p.experimental, p.patterns]);
  assert.deepEqual(through(original), through(alternative));
  const prefix = automaticChainAnalysis(shortRows.filter(r => r.round < 100), smallOptions);
  assert.deepEqual(prefix.recommendation.lines, original.validation.rounds.find(r => r.round === 100).experimental);
  assert.ok(original.validation.rounds.every(r => r.through === r.round - 1 && r.experimental.length === r.baseline.length));
});

test('small/incomplete data falls back to the exact legacy uniform baseline and never fabricates validation', async () => {
  const { automaticChainAnalysis } = await core;
  const { newHistory, picksFor } = await import('../assets/lotto-strategies.js');
  for (const input of [rows.slice(0, 5), rows.filter(r => r.round !== 10)]) {
    const r = automaticChainAnalysis(input);
    assert.equal(r.model.fallback, true);
    assert.deepEqual(r.recommendation.lines, picksFor(newHistory(), r.model.target, 8, 645));
    assert.equal(r.validation.n, 0); assert.equal(r.validation.pValue, null);
    assert.equal(r.validation.experimentalMean, null);
  }
  assert.throws(() => automaticChainAnalysis([rows[0], rows[0]]), /중복/);
});

test('long registered conditions keep exact all-history counts even outside the current mining beam', async () => {
  const { AutomaticChainState } = await core;
  const state = new AutomaticChainState({ ...smallOptions, minSupport: 3, maxLength: 11, maxLongQueries: 2000 });
  const fixture = Array.from({ length: 80 }, (_, i) => ({ round: i + 1, numbers: i % 2 ? [1, 2, 3, 4, 5, 7] : [1, 2, 3, 4, 5, 6] }));
  fixture.forEach(row => { const prepared = state.prepare(row.round); state.append(row, prepared); });
  assert.ok(state.longModels.size > 0);
  assert.equal(state.limits.deepest, 11);
  for (const entry of [...state.longModels].slice(0, 40)) {
    const matching = fixture.filter(r => entry.lags.every((lag, i) => fixture[r.round - lag - 1] && entry.stages[i].every(n => fixture[r.round - lag - 1].numbers.includes(n))));
    assert.equal(entry.trials, matching.length);
    assert.equal(entry.validationTrials, matching.filter(r => r.round >= entry.registeredAt).length);
  }
});

test('manual chain options, number-level evidence, copy and research backup round-trip without changing purchases', async () => {
  const rec = await records, { sealResearch } = await import('../assets/research-provenance.js');
  const snapshot = await rec.createAutoSnapshot(shortRows, smallOptions, undefined, now);
  assert.equal(await rec.verifyAutoSnapshot(snapshot, shortRows, smallOptions), true);
  const { createManualRecord } = await import('../assets/manual-generation.js');
  const base = { strategy: 'chain-experiment', autoChain: snapshot, games: 5, uniqueLines: false, spread: false, seed: 645, id: 'auto-manual', now: new Date('2005-03-21T02:00:00Z') };
  // Pick a time after the latest input's official date but before the next cutoff.
  base.now = new Date(shortRows.at(-1).date + 'T12:00:00Z');
  const manual = await sealResearch(createManualRecord(shortRows, base));
  assert.deepEqual(manual.lines, snapshot.result.recommendation.lines);
  const { recommendationHTML, recommendationReport } = await import('../assets/recommendation-report.js');
  assert.match(recommendationHTML(manual), /10번째/); assert.match(recommendationReport(manual), /역사적 패턴|가중치|기본 가중치/);
  const { chainNumberReason } = await import('../assets/chain-auto-report.js');
  for (const n of manual.lines[4]) {
    assert.match(chainNumberReason(manual, 4, n), /사용하지 않았/);
    assert.deepEqual(manual.research.trace[4].decisions.find(d => d.number === n).influences, []);
  }
  const spread = createManualRecord(shortRows, { ...base, games: 7, spread: true });
  assert.equal(new Set(spread.lines.flat()).size, 42); assert.equal(spread.comparable, false);
  assert.throws(() => createManualRecord(shortRows, { ...base, games: 8, spread: true }), /최대 7/);
  const alteredRows = structuredClone(shortRows); alteredRows[0].numbers = [1, 2, 3, 4, 5, 6];
  assert.throws(() => createManualRecord(alteredRows, base), /최신 자동 분석/);
  const storageMap = new Map([['lotto_lab_v3_private_records', 'preserve-purchases']]);
  const storage = { getItem: k => storageMap.get(k) ?? null, setItem: (k, v) => storageMap.set(k, v) };
  const archive = await import('../assets/research-archive.js');
  assert.equal(await archive.verifyManual(manual), 'verified');
  await archive.importResearch({ schema: 1, kind: 'recommendations', records: [manual] }, storage);
  assert.equal(archive.exportResearch('recommendations', storage).records.length, 1);
  assert.equal(storageMap.get('lotto_lab_v3_private_records'), 'preserve-purchases');
});

test('auto snapshots bind data/config and preserve old/corrupt storage and failed writes', async () => {
  const r = await records, { sealResearch } = await import('../assets/research-provenance.js');
  const snapshot = await r.createAutoSnapshot(shortRows, smallOptions, undefined, now);
  const altered = structuredClone(snapshot); altered.result.recommendation.lines[0][0] = 45;
  assert.equal(await r.verifyAutoSnapshot(altered, shortRows, smallOptions), false);
  assert.equal(await r.verifyAutoSnapshot(snapshot, shortRows.slice(0, -1), smallOptions), false);
  assert.equal(await r.verifyAutoSnapshot(snapshot, shortRows, { ...smallOptions, seed: 1 }), false);
  assert.equal(await r.verifyAutoSnapshot(await sealResearch(altered), shortRows, smallOptions), false);
  const map = new Map([['lotto_lab_v3_private_records', 'old'], [r.AUTO_CHAIN_KEY, '{broken']]);
  const storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  await assert.rejects(r.saveAutoSnapshot(snapshot, storage), /JSON|Unexpected|position/);
  assert.equal(map.get(r.AUTO_CHAIN_KEY), '{broken'); assert.equal(map.get('lotto_lab_v3_private_records'), 'old');
  map.delete(r.AUTO_CHAIN_KEY); await r.saveAutoSnapshot(snapshot, storage);
  const previous = map.get(r.AUTO_CHAIN_KEY);
  await r.saveAutoSnapshot(snapshot, storage); assert.equal(map.get(r.AUTO_CHAIN_KEY), previous);
});

test('server auto updates are create-only, refuse overlaps and preserve the previous report on failure', async () => {
  const temporary = join(__dirname, '../.test-tmp'); mkdirSync(temporary, { recursive: true });
  const root = mkdtempSync(join(temporary, 'lotto-auto-'));
  mkdirSync(join(root, 'data')); writeFileSync(join(root, 'data/draws.json'), JSON.stringify({ draws: shortRows }));
  const { updateAutomaticChain } = await import('../scripts/update-chain-auto.mjs');
  const first = await updateAutomaticChain({ root, now, options: smallOptions });
  const latest = join(root, 'data/chain-auto/latest.json'), before = readFileSync(latest, 'utf8');
  await updateAutomaticChain({ root, now, options: smallOptions, analyze: () => { throw Error('should use cache'); } });
  assert.equal(readFileSync(latest, 'utf8'), before);
  assert.ok(existsSync(join(root, 'data/chain-auto/snapshots', `${first.data.last}-${first.id}.json`)));
  writeFileSync(join(root, 'data/draws.json'), JSON.stringify({ draws: rows.slice(0, 121) }));
  await assert.rejects(updateAutomaticChain({ root, now, options: smallOptions, analyze: () => { throw Error('simulated failure'); } }), /simulated/);
  assert.equal(readFileSync(latest, 'utf8'), before);
  assert.equal(JSON.parse(readFileSync(join(root, 'data/chain-auto/health.json'))).state, 'error');
  writeFileSync(join(root, 'data/chain-auto/.lock'), 'active');
  await assert.rejects(updateAutomaticChain({ root, now, options: smallOptions }), /EEXIST/);
  assert.equal(readFileSync(latest, 'utf8'), before);
});

test('auto service deduplicates notifications, cancels stale jobs and safely substitutes uniform on worker failure', async () => {
  const { createAutoChainService } = await import('../assets/chain-auto-service.js');
  const workers = [];
  class FakeWorker { constructor() { workers.push(this); } postMessage(job) { this.job = job; } terminate() { this.closed = true; } }
  const service = createAutoChainService({ WorkerClass: FakeWorker, now: () => now, options: smallOptions });
  await service.load(shortRows); await service.load(shortRows);
  assert.equal(workers.length, 1);
  const old = workers[0], staleCallback = old.onmessage;
  await service.load(rows.slice(0, 121)); assert.equal(old.closed, true); assert.equal(workers.length, 2);
  await staleCallback({ data: { result: {} } }); assert.equal(service.getState().record, null);
  await workers[1].onmessage({ data: { error: 'test-worker-failure' } });
  assert.equal(service.getState().record.result.model.fallback, true);
  assert.equal(service.getState().record.result.validation.pValue, null);
  assert.equal(service.getState().record.result.model.target, 122);
  await service.load(rows.slice(0, 122)); service.cancel(); assert.equal(workers[2].closed, true);
  assert.equal(service.getState().phase, 'cancelled');
});
