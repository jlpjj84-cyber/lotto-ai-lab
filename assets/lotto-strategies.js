import './lotto-picks.js';
import { DEFAULT_SEED, seededRandom } from './research-math.js';
import { PAIR_INDEX, PAIRS } from './research-patterns.js';

export const WARMUP = 50;
export const GAMES_PER_DRAW = 5;
export const STRATEGY_VERSION = '4.0.0';
export const STRATEGIES = Object.freeze([
  ['all-hot', '전체 이력 빈출 가중'], ['hot-30', '최근 30회 빈출 가중'], ['hot-50', '최근 50회 빈출 가중'],
  ['cold-50', '최근 50회 저빈출 가중'], ['overdue', '장기 미출현 우선'], ['pairs', '동시 출현 번호쌍'],
  ['pattern', '홀짝·합계·연속 필터'], ['spread', '수동 4게임 번호 분산'], ['random', '균등 무작위 5게임'],
]);

const { generateManual, uniformLine } = globalThis.LottoPicks;
const allNumbers = Array.from({ length: 45 }, (_, index) => index + 1);
const ordered = numbers => numbers.sort((a, b) => a - b);
export const randomFor = (round, offset, seed = DEFAULT_SEED) => seededRandom(seed ^ Math.imul(round, 0x9e3779b1) ^ Math.imul(offset, 0x85ebca6b));

export function newHistory() {
  return {
    lastRound: null, contiguous: 0, lastSeen: new Uint16Array(46),
    rows: [], totals: new Uint16Array(46), recent30: new Uint16Array(46),
    recent50: new Uint16Array(46), pairs: new Uint16Array(PAIRS.length),
  };
}

export function addDraw(history, row) {
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

function pairLines(history, random, available, games) {
  const pool = new Set(available);
  const tie = [0, ...allNumbers.map(() => random())];
  const result = [];
  for (let game = 0; game < games; game++) {
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

function patternLines(random, available, games) {
  const result = [];
  const seen = new Set();
  // Fixed before evaluation: 3 odds, sum 100–149, at least one adjacent pair.
  for (let attempt = 0; attempt < 2048 && result.length < games; attempt++) {
    const line = uniformLine(random, available);
    const key = line.join(',');
    const sum = line.reduce((total, number) => total + number, 0);
    const odds = line.reduce((total, number) => total + (number & 1), 0);
    if (odds === 3 && sum >= 100 && sum <= 149 && !seen.has(key) && line.some((number, i) => number === line[i - 1] + 1)) {
      seen.add(key);
      result.push(line);
    }
  }
  return result.length === games ? result : null;
}

function strategyLines(history, id, random, available = allNumbers, games = 4) {
  if (id === 'overdue') {
    const tailStart = history.lastRound - history.contiguous + 1;
    const age = number => history.lastRound - Math.max(tailStart - 1, history.lastSeen[number]);
    const ranked = available.map(number => ({ number, age: age(number), tie: random() }))
      .sort((a, b) => b.age - a.age || a.tie - b.tie).map(item => item.number);
    return Array.from({ length: games }, (_, i) => ordered(ranked.slice(i * 6, i * 6 + 6)));
  }
  if (id === 'pairs') return pairLines(history, random, available, games);
  if (id === 'pattern') return patternLines(random, available, games);
  const counts = id === 'all-hot' ? history.totals : id === 'hot-30' ? history.recent30 : history.recent50;
  const mode = id.endsWith('hot') || id.startsWith('hot-') ? 'hot' : id === 'cold-50' ? 'cold' : id;
  return generateManual({ mode, unique: id !== 'random', counts, random, available, games });
}

function picksFor(history, round, index, seed) {
  const manual = strategyLines(history, STRATEGIES[index][0], randomFor(round, index + 2, seed));
  if (!manual) throw Error('고정 패턴을 만족하는 4게임을 구성하지 못했습니다.');
  return [...manual, uniformLine(randomFor(round, 1, seed))];
}

export function makePicks(history, round) {
  return STRATEGIES.map((_, index) => picksFor(history, round, index, DEFAULT_SEED));
}

function priorHistory(rows, round) {
  const history = newHistory();
  for (const row of rows) {
    if (row.round >= round) break;
    addDraw(history, row);
  }
  return history.contiguous >= WARMUP && history.lastRound === round - 1 ? history : null;
}

export function forecastAt(rows, round) {
  const history = priorHistory(rows, round);
  return history && makePicks(history, round);
}

export function generateForStrategy(rows, round, id, {
  seed = DEFAULT_SEED, games = GAMES_PER_DRAW, uniqueLines = false, spread = false,
} = {}) {
  const index = STRATEGIES.findIndex(([key]) => key === id);
  if (index < 0 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isInteger(games) || games < 1 || games > 20 || typeof uniqueLines !== 'boolean' || typeof spread !== 'boolean') {
    throw Error('전략, 시드 또는 게임 수가 올바르지 않습니다.');
  }
  const history = priorHistory(rows, round);
  if (!history) return null;
  let lines;
  if (spread) {
    if (games > 7) throw Error('게임 간 번호 중복을 금지하면 최대 7게임까지 가능합니다.');
    // Restrict the actual candidate pool so that even seven disjoint games can be generated.
    for (let attempt = 0; attempt < 20 && !lines; attempt++) {
      const random = randomFor(round, index + 20 + attempt, seed);
      let available = allNumbers;
      const batch = [];
      for (let game = 0; game < games; game++) {
        const line = (game + 1) % GAMES_PER_DRAW === 0 ? uniformLine(random, available)
          : strategyLines(history, id, random, available, 1)?.[0];
        if (!line) break;
        batch.push(line);
        available = available.filter(number => !line.includes(number));
      }
      if (batch.length === games) lines = batch;
    }
  } else {
    const result = [];
    const seen = new Set();
    for (let batch = 0; batch < 256 && result.length < games; batch++) {
      const batchSeed = (seed + Math.imul(batch, 0x9e3779b1)) >>> 0;
      for (const line of picksFor(history, round, index, batchSeed)) {
        const key = line.join(',');
        if (uniqueLines && seen.has(key)) continue;
        result.push(line);
        seen.add(key);
        if (result.length === games) break;
      }
    }
    if (result.length === games) lines = result;
  }
  if (!lines) throw Error('이 전략으로 선택한 제약을 충족할 수 없습니다. 게임 수나 옵션을 조정해 주세요.');
  const length = id === 'hot-30' ? 30 : ['hot-50', 'cold-50'].includes(id) ? 50 :
    id === 'overdue' ? history.contiguous : ['all-hot', 'pairs'].includes(id) ? history.rows.length : 0;
  return { lines, latest: history.lastRound, historyFirst: length ? history.rows.at(-length).round : null,
    historyCount: length, comparable: games === GAMES_PER_DRAW && !uniqueLines && !spread };
}
