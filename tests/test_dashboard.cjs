const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const picks = fs.readFileSync(path.join(__dirname, '../assets/lotto-picks.js'), 'utf8');
const storageKey = 'lotto_lab_v3_private_records';
const draw = { round: 1249, date: '2026-11-07', numbers: [2, 11, 16, 25, 34, 35], bonus: 14 };
const line = { label: 'A', type: '직접 입력', numbers: [1, 2, 3, 4, 5, 6] };
const legacy = { draws: [draw], tickets: [{ round: 1250, lines: [line], savedAt: '2026-11-08', origin: '직접 등록' }], source: '기존 백업' };

async function dashboard(saved = legacy) {
  const elements = new Map();
  const defaults = { overviewRange: '100', statsRange: '100', recentCount: '30', genMode: 'spread', weeklyLimit: '5000' };
  const storage = { raw: typeof saved === 'string' ? saved : JSON.stringify(saved), fail: false };
  const dialogs = [];
  const windowEvents = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: defaults[id] || '', checked: true, innerHTML: '', textContent: '', hidden: false,
      classList: { toggle() {}, add() {}, remove() {} }, events: new Map(),
      addEventListener(name, handler) { this.events.set(name, handler); },
      click() {}, focus() {}
    });
    return elements.get(id);
  }
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-10T12:00:00+09:00'])); }
    static now() { return new Date('2026-11-10T12:00:00+09:00').getTime(); }
  }
  const context = vm.createContext({
    console, Date: FixedDate, structuredClone, crypto: { randomUUID }, AbortController,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    document: { getElementById: element, querySelectorAll() { return []; }, querySelector() { return element('tab'); } },
    window: { addEventListener(name, handler) { windowEvents.set(name, handler); } },
    navigator: { locks: { request(name, callback) { return Promise.resolve().then(callback); } } },
    localStorage: {
      getItem(key) { assert.equal(key, storageKey); return storage.raw; },
      setItem(key, value) {
        assert.equal(key, storageKey);
        if (storage.fail) throw Error('QuotaExceededError');
        storage.raw = value;
      }
    },
    fetch: async () => { throw Error('offline test'); },
    confirm(message) { dialogs.push(message); return true; }
  });
  const run = source => vm.runInContext(source, context);
  run(picks);
  run(script);
  await new Promise(resolve => setImmediate(resolve));
  return { run, storage, element, dialogs, windowEvents, read: source => JSON.parse(run(`JSON.stringify(${source})`)) };
}

test('legacy purchases survive append, reload, edit and deletion by ID', async () => {
  const app = await dashboard();
  assert.equal(app.read('state.tickets')[0].id, 'legacy-0');
  await app.run(`createRecord(1250, ${JSON.stringify([line])}, '추가 구매')`);
  assert.equal(app.read('state.tickets').length, 2);
  assert.equal(app.read('ticketStats()').spent, 2000);
  const reloaded = await dashboard(app.storage.raw);
  const ids = reloaded.read('state.tickets.map(ticket => ticket.id)');
  await reloaded.run(`createRecord(1250, [{label:'A',numbers:[7,8,9,10,11,12]}], '수정', structuredClone(state.tickets[1]))`);
  assert.deepEqual(reloaded.read('state.tickets.map(ticket => ticket.id)'), ids);
  assert.deepEqual(reloaded.read('state.tickets[0].lines[0].numbers'), line.numbers);
  await reloaded.element('recordList').events.get('click')({ target: { closest: () => ({ dataset: { del: ids[1] } }) } });
  assert.deepEqual(reloaded.read('state.tickets.map(ticket => ticket.id)'), [ids[0]]);
});

test('failed browser persistence leaves both stored and displayed purchases intact', async () => {
  const app = await dashboard();
  const before = app.storage.raw;
  const displayed = app.read('state.tickets');
  app.storage.fail = true;
  await assert.rejects(app.run(`createRecord(1250, ${JSON.stringify([line])}, '추가 구매')`), /저장하지 못했습니다/);
  assert.equal(app.storage.raw, before);
  assert.deepEqual(app.read('state.tickets'), displayed);
  assert.equal(app.element('storageNotice').hidden, false);
});

test('a stale tab cannot replace a newer stored snapshot', async () => {
  const app = await dashboard();
  const newer = { ...legacy, source: '다른 탭의 변경' };
  app.storage.raw = JSON.stringify(newer);
  await assert.rejects(app.run(`createRecord(1250, ${JSON.stringify([line])}, '추가 구매')`), /다른 탭/);
  assert.equal(JSON.parse(app.storage.raw).source, '다른 탭의 변경');
});

test('storage events refresh records and stale edit forms are rejected', async () => {
  const app = await dashboard();
  app.run('editingRecord=structuredClone(state.tickets[0])');
  app.storage.raw = JSON.stringify({ ...legacy, tickets: [] });
  app.windowEvents.get('storage')({ key: storageKey });
  await assert.rejects(app.run(`createRecord(1250, ${JSON.stringify([line])}, '수정', editingRecord)`), /수정 중인 기록/);
  assert.equal(app.read('state.tickets').length, 0);
});

test('old JSON backups restore through the upload handler after a count preview', async () => {
  const app = await dashboard({ ...legacy, tickets: [] });
  const input = { files: [{ text: async () => JSON.stringify({ ...legacy, schema: 'lottolab-v1' }) }], value: 'backup.json' };
  await app.element('jsonUpload').events.get('change')({ target: input });
  assert.match(app.dialogs[0], /구매 1건 \(1게임\)/);
  assert.equal(app.read('state.tickets').length, 1);
  assert.equal(JSON.parse(app.storage.raw).tickets.length, 1);
  assert.equal(input.value, '');
});

test('malformed backups are rejected before confirmation or any state changes', async () => {
  const badBackups = [
    { ...legacy, tickets: [null] },
    { ...legacy, tickets: [{ round: 1250, lines: [] }] },
    { ...legacy, tickets: [{ round: 1250, lines: [{ numbers: [1, 1, 2, 3, 4, 5] }] }] },
    { ...legacy, tickets: [{ round: 0, lines: [line] }] },
    { ...legacy, tickets: [{ round: 1250, lines: [line], id: '<unsafe>' }] },
    { ...legacy, draws: [draw, draw] },
    { ...legacy, draws: [{ ...draw, date: 'invalid-date' }] },
    { ...legacy, draws: [{ ...draw, prizes: { 1: -100 } }] },
    { ...legacy, schema: 'future-unsupported-version' }
  ];
  const app = await dashboard();
  const before = app.storage.raw;
  for (const backup of badBackups) {
    const input = { files: [{ text: async () => JSON.stringify(backup) }], value: 'invalid.json' };
    await app.element('jsonUpload').events.get('change')({ target: input });
    assert.equal(app.storage.raw, before);
    assert.equal(app.read('state.tickets').length, 1);
  }
  assert.deepEqual(app.dialogs, []);
});

test('failed restore and reset preserve original purchases', async () => {
  const app = await dashboard();
  const before = app.storage.raw;
  app.storage.fail = true;
  await app.element('jsonUpload').events.get('change')({ target: { files: [{ text: async () => JSON.stringify({ ...legacy, tickets: [] }) }], value: '' } });
  assert.equal(app.storage.raw, before);
  assert.equal(app.read('state.tickets').length, 1);
  await app.element('resetAll').events.get('click')();
  assert.equal(app.storage.raw, before);
  assert.equal(app.read('state.tickets').length, 1);
});

test('unreadable local records are preserved and can be exported as the original backup', async () => {
  const app = await dashboard('{broken-json');
  await assert.rejects(app.run(`createRecord(1250, ${JSON.stringify([line])}, '추가 구매')`), /백업하고 복원/);
  assert.equal(app.storage.raw, '{broken-json');
  app.run('globalThis.downloaded=null; downloadBlob=(text,name)=>{globalThis.downloaded={text,name}}');
  app.element('exportBackup').events.get('click')();
  assert.equal(app.read('downloaded').text, '{broken-json');
});

test('offline, successful sync and overdue draw status appear on the overview', async () => {
  const app = await dashboard();
  assert.match(app.element('syncOverview').innerHTML, /연결 실패 · 저장 데이터 표시 중/);
  app.run(`fetch=async()=>({ok:true,json:async()=>(${JSON.stringify({ draws: [draw], updatedAt: '2026-11-08T20:10:36+09:00' })})})`);
  await app.run('syncGithubData()');
  assert.match(app.element('syncOverview').innerHTML, /최신 데이터 확인 완료/);
  assert.equal(JSON.parse(app.storage.raw).serverUpdatedAt, '2026-11-08T20:10:36+09:00');
  app.run(`Date.now=()=>new Date('2026-11-14T20:34:59+09:00').getTime();renderSyncStatus()`);
  assert.doesNotMatch(app.element('syncOverview').innerHTML, /결과 반영 대기/);
  app.run(`Date.now=()=>new Date('2026-11-14T20:35:00+09:00').getTime();renderSyncStatus()`);
  assert.match(app.element('syncOverview').innerHTML, /1250회부터 결과 반영 대기/);
});
