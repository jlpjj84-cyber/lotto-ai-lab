const assert = require('node:assert/strict');
const { test } = require('node:test');
const { draws } = require('../data/draws.json');
const manual = import('../assets/manual-generation.js');
const rows = draws.filter(row => row.round < 1250).sort((a, b) => a.round - b.round);

test('manual record removal is scoped by ID and preserves saved records', async () => {
  const { createManualRecord, readManualRecords, removeManualRecord } = await manual;
  const options = { strategy: 'spread', games: 5, uniqueLines: false, spread: false,
    seed: 645, now: new Date('2026-11-14T09:00:00Z') };
  const first = createManualRecord(rows, { ...options, id: 'delete-one' });
  const second = createManualRecord(rows, { ...options, id: 'keep-two' });
  const raw = JSON.stringify({ schema: 1, records: [first, second] });
  const result = removeManualRecord(raw, first.id);
  assert.equal(result.removed, true);
  assert.deepEqual(result.records, [second]);
  assert.deepEqual(readManualRecords(raw), [first, second]);
  assert.deepEqual(readManualRecords(JSON.stringify({ schema: 1, records: result.records })), [second]);
  assert.deepEqual(removeManualRecord(JSON.stringify({ schema: 1, records: result.records }), first.id),
    { removed: false, records: [second] });
  assert.deepEqual(removeManualRecord(null, first.id), { removed: false, records: [] });
  assert.throws(() => removeManualRecord(raw, 'bad/id'), /ID/);
  assert.throws(() => removeManualRecord('{broken}', first.id), /JSON|Unexpected|position/);
});
