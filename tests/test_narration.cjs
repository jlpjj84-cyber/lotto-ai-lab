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
const commonTitle = '추천 전략 및 공통 검증 요약';
const total = line => line.reduce((sum, number) => sum + number, 0);
const odds = line => line.filter(number => number % 2).length;
const strategyTexts = /워크포워드|몬테카를로|참고 통계 열|1\/8,145,060|전략은/;
const occurrences = (text, snippet) => text.split(snippet).length - 1;

async function makeRecord(strategy, overrides = {}) {
  return (await manual).createManualRecord(rows, { ...options, strategy, ...overrides });
}

async function describe(record) {
  return (await narration).describeRecommendation(record);
}

test('all nine strategies retain the actual 1250 picks while showing a single common explanation', async () => {
  const { STRATEGIES } = await import('../assets/lotto-strategies.js');
  for (const { id, games } of prediction.strategies) {
    const record = await makeRecord(id);
    assert.deepEqual(record.lines, games, id);
    const explanation = await describe(record);
    assert.equal(explanation.games.length, 5);
    assert.equal(new Set(explanation.games.map(g => g.selection + g.observed)).size, 5, id);
    assert.ok(explanation.common[0].includes(new Map(STRATEGIES).get(id)));
    assert.equal(occurrences(explanation.common.join(' '), '1/8,145,060'), 1);
    assert.equal(occurrences(explanation.common.join(' '), '이 추천에 연결된 검증 결과는 없습니다.'), 1);
    for (const game of explanation.games) {
      const length = (game.selection + ' ' + game.observed).split('. ').length;
      assert.ok(length >= 2 && length <= 4);
      assert.doesNotMatch(game.selection + game.observed, strategyTexts);
    }
    assert.match(explanation.games[4].title, /공통 무작위/);
    assert.match(explanation.games[4].selection, /45개 후보/);
  }
});

test('weighted games cite the first draw and a recorded weight, including pool reductions by game', async () => {
  const histories = {
    'all-hot': rows, 'hot-30': rows.slice(-30), 'hot-50': rows.slice(-50), 'cold-50': rows.slice(-50),
  };
  for (const [id, history] of Object.entries(histories)) {
    const record = await makeRecord(id);
    const { common, games } = await describe(record);
    const cold = id === 'cold-50';
    assert.ok(common[0].includes(cold ? '적을수록' : '많을수록'));
    assert.ok(common[0].includes(id === 'all-hot' ? '전체 이력' : `최근 ${history.length}회`));
    for (let i = 0; i < 4; i++) {
      const { pool, decisions } = record.research.lines[i].selection;
      const chosen = decisions.reduce((best, decision) => decision.weight > best.weight ? decision : best);
      assert.equal(chosen.count, history.filter(draw => draw.numbers.includes(chosen.number)).length);
      assert.equal(chosen.weight, (cold ? 60 - chosen.count : chosen.count + 2) ** 2);
      assert.ok(games[i].selection.includes(`${pool}개 후보에서 처음 뽑힌 번호는 ${decisions[0].number}번`));
      assert.ok(games[i].selection.includes(`${chosen.number}번`));
      assert.ok(games[i].selection.includes(`${chosen.count}회`));
      assert.match(games[i].selection, new RegExp(`가중치는 ${chosen.weight}(?:로|입니다)`));
      if (i) assert.ok(games[i].selection.includes(`번호 ${45 - pool}개를 제외`));
    }
  }
});

test('overdue ranks account for prior allocations in a batch and for a fresh ranking in full spread', async () => {
  const overdue = await makeRecord('overdue');
  const { decisions, pool } = overdue.research.lines[1].selection;
  const first = decisions[0];
  const observed = rows.findLast(draw => draw.numbers.includes(first.number));
  assert.equal(first.age, overdue.dataRound - observed.round);
  assert.equal(pool, 45);
  assert.equal(first.rank, 7);
  const { games } = await describe(overdue);
  assert.match(games[1].selection, /번호 6개를 제외한 39개 후보에서 기록된 순위 7~12/);
  assert.match(games[1].selection, new RegExp(`${first.number}번은 ${first.age}회.*후보 7위`));

  const spread = await makeRecord('overdue', { spread: true });
  assert.equal(spread.research.lines[1].selection.pool, 39);
  assert.match((await describe(spread)).games[1].selection, /번호 6개를 제외한 39개 후보에서 기록된 순위 1~6/);
  const limitedHistory = rows.slice(-50).map(draw => ({ ...draw, numbers: [1, 2, 3, 4, 5, 6] }));
  const censored = (await manual).createManualRecord(limitedHistory, { ...options, strategy: 'overdue' });
  assert.match((await describe(censored)).games[0].selection, /50회 이상 나오지 않아/);
});

test('pairs and pattern describe their true criteria and separate after-selection observations', async () => {
  const pairs = await makeRecord('pairs');
  const [a, b, c] = pairs.research.lines[0].selection.decisions;
  const both = (x, y) => rows.filter(draw => draw.numbers.includes(x) && draw.numbers.includes(y)).length;
  assert.equal(a.count, both(a.number, b.number));
  assert.equal(c.score, both(c.number, a.number) + both(c.number, b.number));
  const pairStory = (await describe(pairs)).games[0].selection;
  assert.ok(pairStory.includes(`${a.count}회 함께 나온 ${a.number}번과 ${b.number}번`));
  assert.ok(pairStory.includes(`${c.number}번의 두 번호에 대한 동시 출현 점수는 합계 ${c.score}`));

  const pattern = await makeRecord('pattern');
  const { common, games } = await describe(pattern);
  const { filter } = pattern.research.lines[0].selection;
  assert.ok(common[0].includes(`홀수 ${filter.odds}개, 합계 ${filter.sumMin}~${filter.sumMax}, 연속번호 ${filter.adjacent}쌍 이상`));
  for (let i = 0; i < 4; i++) {
    const { attempt } = pattern.research.lines[i].selection;
    const line = pattern.lines[i];
    const adjacent = line.filter((number, index) => number === line[index - 1] + 1).length;
    assert.ok(games[i].selection.includes(`${attempt}번째 후보 조합이 홀짝 ${odds(line)}대${6 - odds(line)}, 합계 ${total(line)}, 연속번호 ${adjacent}쌍으로 필터를 통과`));
    assert.match(games[i].observed, /선정 후 번호 구간/);
    assert.doesNotMatch(games[i].observed, /필터|추출 가중치/);
  }
});

test('sum, parity, runs and range highlights use only the selected line and avoid claiming a difference on ties', async () => {
  const lines = [
    [1, 3, 8, 13, 22, 39],
    [6, 7, 8, 12, 19, 38],
    [11, 14, 19, 22, 29, 44],
    [23, 28, 34, 37, 41, 45],
    [3, 13, 18, 24, 34, 39],
  ];
  const record = { strategy: 'random', lines, research: { lines: lines.map(line => ({
    selection: { method: 'uniform', pool: 45, decisions: line.slice().reverse().map((number, i) => ({ number, pool: 45 - i })) },
    features: { sum: 999, odd: 6, bands: [0, 0, 0, 0, 6], runs: [[44, 45]] },
    reference: [{ number: line[0], recent: 999, gap: 999 }],
  })) } };
  const { games } = await describe(record);
  assert.ok(games[0].observed.includes(`가장 낮은 ${total(lines[0])}이고, 홀짝은 ${odds(lines[0])}대${6 - odds(lines[0])}`));
  assert.match(games[1].observed, /6·7·8번.*가장 긴 연속 구간은 번호 3개/);
  assert.match(games[2].observed, /선정 후 11~20번 구간에 번호 3개/);
  assert.ok(games[3].observed.includes(`가장 높은 ${total(lines[3])}이고, 홀짝은 ${odds(lines[3])}대${6 - odds(lines[3])}`));
  for (const game of games) {
    assert.doesNotMatch(game.selection, /합계|홀짝|출현|필터|가중치|999/);
    assert.doesNotMatch(game.observed, /999|44·45/);
  }
  const tied = { ...record, lines: [lines[1], lines[1]], research: { lines: Array(2).fill(record.research.lines[1]) } };
  assert.equal((await describe(tied)).games[0].observed, (await describe(tied)).games[1].observed);
  assert.doesNotMatch((await describe(tied)).games[1].observed, /가장 긴|유일/);
});

test('shared and spread random games show their actual trace, even when displayed at another position', async () => {
  const record = await makeRecord('spread');
  const { common, games } = await describe(record);
  assert.equal(new Set(record.lines.slice(0, 4).flat()).size, 24);
  for (let i = 0; i < 5; i++) {
    const { decisions, pool } = record.research.lines[i].selection;
    assert.ok(games[i].selection.includes(`${pool}개 후보에서 처음 ${decisions[0].number}번`));
    assert.ok(games[i].selection.includes(`남은 ${decisions.at(-1).pool}개 중 ${decisions.at(-1).number}번`));
  }
  assert.match(common[0], /같은 확률/);
  assert.match(games[4].title, /공통 무작위/);
  assert.doesNotMatch(games[4].selection, /제외|가중치|같은 확률/);

  const extended = await makeRecord('hot-30', { games: 7, spread: true, uniqueLines: true });
  assert.equal(new Set(extended.lines.flat()).size, 42);
  const fifth = (await describe(extended)).games[4];
  assert.match(fifth.title, /분산 무작위/);
  assert.match(fifth.selection, /번호 24개를 제외한 21개 후보/);
  assert.doesNotMatch(fifth.selection, /공통 무작위|가중치/);

  const subset = { ...record, lines: [record.lines[4], record.lines[2]],
    research: { lines: [record.research.lines[4], record.research.lines[2]] } };
  const reindexed = (await describe(subset)).games;
  assert.match(reindexed[0].title, /^1게임.*공통 무작위/);
  assert.match(reindexed[1].selection, /번호 12개를 제외한 33개 후보/);
});

function attachValidation(record) {
  record.research.validation = {
    backtest: { rounds: 249, games: 1245, first: 1001, last: 1249, mean: .811, pairedDelta: .006,
      settings: { trainStart: 1 }, adjusted: .78 },
    monteCarlo: { played: 8, first: 1242, last: 1249, repetitions: 10000, seed: 645, mode: 'adaptive',
      settings: { trainStart: 41, window: 50 }, adjusted: null },
  };
}

test('common validation retains the real scope and treats missing, inconclusive and reference results distinctly', async () => {
  const record = await makeRecord('hot-30');
  record.research.validation = { backtest: null, monteCarlo: {} };
  assert.ok((await describe(record)).common.includes('이 추천에 연결된 검증 결과는 없습니다.'));
  attachValidation(record);
  const common = (await describe(record)).common.join('\n');
  assert.equal(occurrences(common, '워크포워드'), 1);
  assert.equal(occurrences(common, '몬테카를로'), 1);
  assert.match(common, /워크포워드 1001~1249회.*평균 0.811개.*보정 p 0.780.*무작위 추첨의 이론값 대비 과거 적중 우위의 통계적 증거 없음/);
  assert.match(common, /몬테카를로 1242~1249회.*순차.*유의성 판단 자료 부족.*참고용/);
  assert.doesNotMatch(common.split('\n').find(line => line.includes('몬테카를로')), /보정 p/);

  record.research.validation.backtest.adjusted = .05;
  record.comparable = false;
  assert.match((await describe(record)).common.join('\n'), /워크포워드.*통계적으로 유의한 과거 차이.*참고용/);
  const random = await makeRecord('random');
  attachValidation(random);
  random.research.validation.backtest.adjusted = null;
  assert.match((await describe(random)).common.join('\n'), /워크포워드.*무작위 비교 기준/);
});

test('legacy and mismatched traces use the saved-evidence fallback', async () => {
  const { MISSING_SELECTION } = await narration;
  const { recommendationHTML, recommendationReport } = await report;
  const legacy = await makeRecord('random', { explain: false });
  assert.equal((await describe(legacy)).common.length, 0);
  assert.equal(occurrences(recommendationHTML(legacy), MISSING_SELECTION), 1);
  assert.equal(occurrences(recommendationReport(legacy), MISSING_SELECTION), 1);
  assert.doesNotMatch(recommendationReport(legacy), /개별 추천 해설/);
  const record = await makeRecord('hot-30');
  record.research.lines[0] = record.research.lines[1];
  assert.equal((await describe(record)).games[0], null);
  assert.equal(occurrences(recommendationHTML(record), MISSING_SELECTION), 1);
});

test('HTML, copied report and saved records preserve one overview, five details and the original hash', async () => {
  const { recommendationHTML, recommendationReport } = await report;
  const { datasetStamp, sealResearch, verifiedResearch } = await import('../assets/research-provenance.js');
  const draft = await makeRecord('hot-30');
  draft.research.data = await datasetStamp(rows);
  attachValidation(draft);
  const record = await sealResearch(draft);
  const before = JSON.stringify(record);
  const { common, games } = await describe(record);
  const html = recommendationHTML(record, ['2개 · 낙첨']);
  assert.ok(html.includes('2개 · 낙첨'));
  const copied = recommendationReport(record);
  for (const content of [html, copied]) {
    assert.equal(occurrences(content, commonTitle), 1);
    assert.ok(content.indexOf(commonTitle) < content.indexOf(games[0].title));
    for (const snippet of [...common, ...games.flatMap(game => [game.title, game.selection, game.observed])]) {
      assert.equal(occurrences(content, snippet), 1, snippet);
    }
  }
  assert.equal(occurrences(html, '<summary>자세한 선정 근거 보기</summary>'), 5);
  const bodies = html.match(/<tbody>.*?<\/tbody>/g);
  assert.equal(bodies.length, 5);
  assert.ok(bodies.every(body => occurrences(body, '<tr>') === 6));
  assert.deepEqual(await describe(JSON.parse(before)), { common, games });
  assert.equal(JSON.stringify(record), before);
  assert.equal(await verifiedResearch(record), true);
});
