const assert = require('node:assert/strict');
const { test } = require('node:test');
const { draws } = require('../data/draws.json');
const prediction = require('../data/predictions/1250.json');

const manual = import('../assets/manual-generation.js');
const narration = import('../assets/recommendation-narration.js');
const report = import('../assets/recommendation-report.js');
const rows = draws.filter(draw => draw.round < 1250).sort((a, b) => a.round - b.round);
const options = { games: 5, uniqueLines: false, spread: false, seed: 645, id: 'narration',
  now: new Date('2026-11-14T09:00:00Z'), explain: true };

async function makeRecord(strategy, overrides = {}) {
  return (await manual).createManualRecord(rows, { ...options, strategy, ...overrides });
}

async function describe(record, index) {
  return (await narration).recommendationNarration(record.lines[index], record.research?.lines[index],
    { ...record, validation: record.research?.validation });
}

test('all nine strategies narrate each game and retain the exact published 1250 picks', async () => {
  const { STRATEGIES } = await import('../assets/lotto-strategies.js');
  for (const { id, games } of prediction.strategies) {
    const record = await makeRecord(id);
    assert.deepEqual(record.lines, games, id);
    const texts = await Promise.all(games.map((_, index) => describe(record, index)));
    assert.equal(new Set(texts).size, 5, id);
    for (const text of texts) {
      assert.ok(text.includes(new Map(STRATEGIES).get(id)));
      assert.ok(text.split('. ').length >= 3 && text.split('. ').length <= 6);
      assert.match(text, /이 추천에 연결된 검증 결과는 없습니다\.$/);
    }
    assert.match(texts[4], /공통 무작위 게임/);
    assert.match(texts[4], /45개 중/);
  }
});

test('weighted stories cite the actual window, first drawn number, count and weight', async () => {
  const histories = {
    'all-hot': rows, 'hot-30': rows.slice(-30), 'hot-50': rows.slice(-50), 'cold-50': rows.slice(-50),
  };
  for (const [id, history] of Object.entries(histories)) {
    const record = await makeRecord(id);
    const [{ number, count, weight }] = record.research.lines[0].selection.decisions;
    const cold = id === 'cold-50';
    assert.equal(count, history.filter(draw => draw.numbers.includes(number)).length);
    assert.equal(weight, (cold ? 60 - count : count + 2) ** 2);
    const summary = await describe(record, 0);
    assert.ok(summary.includes(`${number}번은 이 기간에 ${count}회`));
    assert.ok(summary.includes(`추출 가중치는 ${weight}`));
    assert.ok(summary.includes(cold ? '적을수록' : '많을수록'));
    assert.ok(summary.includes(id === 'all-hot' ? '전체 이력' : `최근 ${history.length}회`));
  }
});

test('overdue, pairs and pattern stories cite only recorded selection data', async () => {
  const overdue = await makeRecord('overdue');
  const delayed = overdue.research.lines[1].selection.decisions[0];
  const observed = rows.findLast(draw => draw.numbers.includes(delayed.number));
  assert.equal(delayed.age, overdue.dataRound - observed.round);
  assert.equal(delayed.rank, 7);
  assert.match(await describe(overdue, 1), new RegExp(`${delayed.number}번은 ${delayed.age}회.*후보 7위`));
  const limitedHistory = rows.slice(-50).map(draw => ({ ...draw, numbers: [1, 2, 3, 4, 5, 6] }));
  const censored = (await manual).createManualRecord(limitedHistory, { ...options, strategy: 'overdue' });
  const top = censored.research.lines[0].selection.decisions[0];
  assert.equal(top.censored, true);
  assert.match(await describe(censored, 0), /50회 이상 나오지 않아/);

  const pairs = await makeRecord('pairs');
  const [a, b, c] = pairs.research.lines[0].selection.decisions;
  const both = (x, y) => rows.filter(draw => draw.numbers.includes(x) && draw.numbers.includes(y)).length;
  assert.equal(a.count, both(a.number, b.number));
  assert.equal(c.score, both(c.number, a.number) + both(c.number, b.number));
  const pairStory = await describe(pairs, 0);
  assert.ok(pairStory.includes(`${a.number}번과 ${b.number}번은 ${a.count}회 함께`));
  assert.ok(pairStory.includes(`${c.number}번의 두 번호에 대한 동시 출현 점수 합계는 ${c.score}`));

  const pattern = await makeRecord('pattern');
  const { selection, features } = pattern.research.lines[0];
  const adjacent = pattern.lines[0].filter((number, i, line) => number === line[i - 1] + 1).length;
  const patternStory = await describe(pattern, 0);
  assert.ok(patternStory.includes(`홀수 ${selection.filter.odds}개, 합계 ${selection.filter.sumMin}~${selection.filter.sumMax}, 연속번호 ${selection.filter.adjacent}쌍 이상`));
  assert.ok(patternStory.includes(`${selection.attempt}번째 후보 조합은 홀짝 ${features.odd}대${6 - features.odd}, 합계 ${features.sum}, 연속번호 ${adjacent}쌍`));
  assert.match(patternStory, /이미 나온 패턴 조합은 제외/);
});

test('uniform inference is independent of frequency and distinguishes spread and shared pools', async () => {
  const random = await makeRecord('random');
  const summary = await describe(random, 0);
  const last = random.research.lines[0].selection.decisions.at(-1);
  random.research.lines[0].reference.forEach(row => { row.gap = 999; row.recent = 0; });
  assert.equal(await describe(random, 0), summary);
  assert.match(summary, /남은 후보의 확률이 같았고/);
  assert.ok(summary.includes(`마지막에는 ${last.pool}개 중 ${last.number}번`));
  assert.match(summary, /출현률과 미출현 기간은 .*참고 통계/);
  assert.doesNotMatch(summary, /가중치|후보 순위|동시 출현 점수/);

  const spread = await makeRecord('spread');
  assert.equal(new Set(spread.lines.slice(0, 4).flat()).size, 24);
  for (let index = 0; index < 4; index++) {
    const story = await describe(spread, index);
    assert.ok(story.includes(`${45 - index * 6}개 중`));
    assert.match(story, /같은 묶음에서 먼저 쓴 번호는 다음 전략 게임 후보에서 제외/);
    assert.doesNotMatch(story, /공통 무작위/);
  }
  assert.match(await describe(spread, 4), /앞선 게임에서 나온 번호도 후보에 포함/);

  const extended = await makeRecord('hot-30', { games: 7, spread: true, uniqueLines: true });
  assert.equal(new Set(extended.lines.flat()).size, 42);
  const fifth = await describe(extended, 4);
  assert.match(fifth, /앞선 게임의 번호를 뺀 후보에서 별도의 무작위 게임/);
  assert.match(fifth, /21개 중/);
  assert.match(fifth, /이미 나온 6개 조합은 전체 생성 결과에서 제외/);
  assert.doesNotMatch(fifth, /공통 무작위|추출 가중치|후보 순위/);
});

test('saved validation describes whole bundles and preserves distinct or unavailable outcomes', async () => {
  const record = await makeRecord('hot-30');
  record.research.validation = { backtest: null, monteCarlo: {} };
  assert.match(await describe(record, 0), /이 추천에 연결된 검증 결과는 없습니다/);
  record.research.validation = {
    backtest: { rounds: 249, settings: { trainStart: 1 }, adjusted: .78 },
    monteCarlo: { played: 8, settings: { trainStart: 41, window: 50 }, adjusted: null },
  };
  const shared = await describe(record, 4);
  assert.match(shared, /워크포워드에서 같은 전략으로 매 회차 만든 5게임을 평가/);
  assert.match(shared, /이론적 기대보다 높은 과거 적중 성과에 대한 통계적 증거는 확인되지 않았습니다/);
  assert.match(shared, /몬테카를로에서 참고로 다른 조건으로 매 회차 만든 5게임을 평가.*판정할 자료가 부족/);
  assert.equal(shared.split('. ').length, 6);
  assert.doesNotMatch(shared, /0\.78|당첨 확률/);
  record.research.validation.backtest.adjusted = .05;
  assert.match(await describe(record, 0), /통계적으로 유의한 차이가 관측됐습니다/);
  record.comparable = false;
  assert.match(await describe(record, 0), /워크포워드에서 참고로 다른 조건으로/);

  const random = await makeRecord('random');
  random.research.validation = { backtest: { rounds: 249, settings: { trainStart: 1 }, adjusted: null } };
  assert.match(await describe(random, 0), /무작위 비교 기준으로 쓰였습니다/);
});

test('missing and mismatched trace falls back to the existing message', async () => {
  const { MISSING_SELECTION, recommendationNarration } = await narration;
  const { evidenceHTML, recommendationReport } = await report;
  const legacy = await makeRecord('random', { explain: false });
  assert.equal(await describe(legacy, 0), null);
  assert.ok(evidenceHTML(legacy.lines[0], undefined, 0, legacy).includes(MISSING_SELECTION));
  assert.ok(recommendationReport(legacy).includes(MISSING_SELECTION));
  assert.doesNotMatch(recommendationReport(legacy), /LOTTO LAB 추천 해설/);
  const current = await makeRecord('hot-30');
  assert.equal(recommendationNarration(current.lines[0], current.research.lines[1], current), null);
  current.research.lines[0].selection.decisions[0].weight = undefined;
  assert.equal(await describe(current, 0), null);
  assert.ok(evidenceHTML(current.lines[0], current.research, 0, current).includes(MISSING_SELECTION));
});

test('report and expandable table share the same deterministic narration without altering the saved hash', async () => {
  const { evidenceHTML, recommendationReport } = await report;
  const { datasetStamp, sealResearch, verifiedResearch } = await import('../assets/research-provenance.js');
  const draft = await makeRecord('hot-30');
  draft.research.data = await datasetStamp(rows);
  const record = await sealResearch(draft);
  const before = JSON.stringify(record);
  const summary = await describe(record, 0);
  const html = evidenceHTML(record.lines[0], record.research, 0, record);
  assert.ok(html.indexOf(summary) > html.indexOf('LOTTO LAB 추천 해설'));
  assert.ok(html.indexOf(summary) < html.indexOf('<details'));
  assert.match(html, /<summary>자세한 선정 근거 보기<\/summary>/);
  assert.equal(html.match(/<tbody>(.*?)<\/tbody>/)[1].match(/<tr>/g).length, 6);
  assert.ok(recommendationReport(record).includes(summary));
  assert.equal(await describe(JSON.parse(before), 0), summary);
  assert.equal(JSON.stringify(record), before);
  assert.equal(await verifiedResearch(record), true);
});
