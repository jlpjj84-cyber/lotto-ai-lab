const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const bytes = readFileSync(join(__dirname, '../data/draws.json'));
const core = import('../scripts/live-core.mjs');
const strategies = import('../assets/lotto-strategies.js');
const scoring = import('../assets/lotto-scoring.js');
const runId = '123456';
const sha = 'a'.repeat(40);
const generated = new Date('2026-11-14T09:00:17.123Z');
const resultTime = new Date('2026-11-14T13:20:00Z');
const official1250 = { round: 1250, date: '2026-11-14', numbers: [1, 2, 3, 4, 5, 6], bonus: 7,
  prizes: { 1: 1000000, 2: 500000, 3: 6000, 4: 4000, 5: 2000 } };

async function fixture() {
  const c = await core;
  const rows = c.parseArchive(bytes).filter(row => row.round < 1250);
  const archive = Buffer.from(JSON.stringify({ draws: rows }));
  const previous = rows.at(-1);
  const record = c.createPrediction(archive, generated, previous, runId);
  const status = { id: 123, creator: { login: 'github-actions[bot]' }, state: 'success',
    context: c.statusContext(1250), description: `sha256:${record.sha256}`,
    created_at: '2026-11-14T09:00:18Z', target_url: `https://github.com/${c.REPO}/actions/runs/${runId}` };
  return { c, archive, record, rows, previous, status, receipt: c.verifyStatus(record, sha, status) };
}

test('Saturday 18:00 KST opens prediction and records UTC, KST, data and exact 4.0 lines', async () => {
  const { c, archive, record, rows } = await fixture();
  assert.deepEqual(c.scheduleFor(1250), { round: 1250, date: '2026-11-14', cutoffUTC: '2026-11-14T11:00:00.000Z', opensUTC: '2026-11-14T09:00:00.000Z' });
  assert.equal(record.generatedAtKST, '2026-11-14T18:00:17.123+09:00');
  assert.equal(record.generatedAtUTC, generated.toISOString());
  assert.equal(record.latestFinalRound, 1249);
  assert.equal(record.dataSha256, c.sha256(archive));
  const s = await strategies;
  assert.deepEqual(record.strategies.map(item => item.games), s.forecastAt(rows, 1250));
  assert.deepEqual(record.strategies.map(item => item.id), s.STRATEGIES.map(([id]) => id));
  assert.ok(record.strategies.every(item => item.games.length === 5 && item.games.every(line => new Set(line).size === 6)));
});

test('late, early, stale, incorrect official input, and target results block generation', async () => {
  const { c, archive, rows, previous } = await fixture();
  assert.throws(() => c.createPrediction(archive, new Date('2026-11-14T08:59:59.999Z'), previous, runId), /18:00/);
  assert.throws(() => c.createPrediction(archive, new Date('2026-11-14T11:00:00Z'), previous, runId), /18:00/);
  assert.throws(() => c.createPrediction(archive, new Date('2026-11-15T09:00:00Z'), previous, runId), /18:00/);
  assert.throws(() => c.createPrediction(archive, generated, null, runId), /동행복권/);
  assert.throws(() => c.createPrediction(archive, generated, { ...previous, bonus: 1 }, runId), /동행복권/);
  assert.throws(() => c.createPrediction(Buffer.from(JSON.stringify({ draws: rows.slice(0, -1) })), generated, previous, runId), /최신 확정/);
  assert.throws(() => c.createPrediction(Buffer.from(JSON.stringify({ draws: [...rows, official1250] })), generated, official1250, runId), /최신 확정/);
  assert.throws(() => c.parseArchive(Buffer.from(JSON.stringify({ draws: [previous, previous] }))), /중복 회차/);
});

test('predictions are create-only and checksums bind the generated numbers and original dataset bytes', async () => {
  const { c, record, archive } = await fixture();
  const { writeNew } = await import('../scripts/live-predictions.mjs');
  const temp = mkdtempSync(join(tmpdir(), 'lotto-live-test-'));
  try {
    const file = join(temp, '1250.json');
    writeNew(file, record);
    const original = readFileSync(file);
    assert.throws(() => writeNew(file, { ...record, runId: '999' }), { code: 'EEXIST' });
    assert.deepEqual(readFileSync(file), original);
    c.verifyPrediction(JSON.parse(original), archive);
    const edited = structuredClone(record);
    edited.strategies[0].games[0][0] = 45;
    assert.throws(() => c.verifyPrediction(edited, archive), /SHA-256/);
    assert.throws(() => c.verifyPrediction(record, Buffer.concat([archive, Buffer.from('\n')])), /재현/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('the GitHub server timestamp, bot, exact payload and commit must agree', async () => {
  const { c, record, status, receipt } = await fixture();
  assert.equal(receipt.commit, sha);
  for (const created_at of ['2026-11-14T11:00:00Z', '2026-11-14T08:59:59Z', 'invalid']) {
    assert.throws(() => c.verifyStatus(record, sha, { ...status, created_at }), /마감 전/);
  }
  assert.throws(() => c.verifyStatus(record, sha, { ...status, creator: { login: 'other' } }), /일치/);
  assert.throws(() => c.verifyStatus(record, sha, { ...status, target_url: `https://github.com/${c.REPO}/actions/runs/999` }), /일치/);
  assert.throws(() => c.verifyStatus(record, sha, { ...status, description: 'different payload' }), /일치/);
});

test('evaluation excludes missing/late proof, premature results and mismatched official numbers', async () => {
  const { c, record, receipt } = await fixture();
  assert.throws(() => c.evaluatePrediction(record, null, official1250, official1250, resultTime), /확인 기록/);
  assert.throws(() => c.evaluatePrediction(record, { ...receipt, confirmedAtUTC: '2026-11-14T11:35:00Z' }, official1250, official1250, resultTime), /마감 전/);
  assert.throws(() => c.evaluatePrediction(record, receipt, official1250, official1250, new Date('2026-11-14T11:34:59Z')), /시각/);
  assert.throws(() => c.evaluatePrediction(record, receipt, official1250, { ...official1250, bonus: 8 }, resultTime), /일치하지/);
  const result = c.evaluatePrediction(record, receipt, official1250, official1250, resultTime);
  assert.equal(result.strategies.length, 9);
  assert.ok(result.strategies.every(row => row.games.length === 5 && row.spent === 5000));
  c.verifyEvaluation(result, record, receipt, official1250);
  result.strategies[0].totalHits++;
  assert.throws(() => c.verifyEvaluation(result, record, receipt, official1250), /해시/);
});

test('scoring distinguishes all prize ranks, bonus match, and unknown prize', async () => {
  const { scoreGame, scoreTickets } = await scoring;
  const draw = { ...official1250, prizes: { 1: 2000, 2: 200, 3: 30, 5: 5 } };
  const lines = [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 7], [1, 2, 3, 4, 5, 8],
    [1, 2, 3, 4, 8, 9], [1, 2, 3, 7, 8, 9], [1, 2, 7, 8, 9, 10]];
  assert.deepEqual(lines.map(line => scoreGame(line, draw).rank), [1, 2, 3, 4, 5, null]);
  assert.deepEqual(lines.map(line => scoreGame(line, draw).bonus), [false, true, false, false, true, true]);
  const result = scoreTickets(lines, draw);
  assert.deepEqual(result.ranks, [0, 1, 1, 1, 1, 1]);
  assert.equal(result.unpriced, 1);
  assert.equal(result.prize, 2235);
});
