import { binomialRange, choose, DRAW_SPACE } from './research-math.js';

export const GROUPS = [
  ['numbers', '번호별 출현'], ['odd', '홀수 개수'], ['sum', '번호 합계'],
  ['run', '최장 연속 길이'], ['end', '같은 끝자리 최대 개수'], ['overlap', '직전 회차 중복'],
  ['bands', '번호 구간별 개수'], ['pairs', '번호쌍'], ['triples', '3개 번호 조합'],
  ['gaps', '최근 출현 간격'],
];
export const SUM_BANDS = [[21, 79], [80, 99], [100, 119], [120, 139],
  [140, 159], [160, 179], [180, 199], [200, 249], [250, 255]];
const NUMBER_BANDS = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 45]];

export const PAIRS = [];
export const TRIPLES = [];
export const PAIR_INDEX = new Uint16Array(46 ** 2);
export const TRIPLE_INDEX = new Uint16Array(46 ** 3);
for (let a = 1; a <= 45; a++) {
  for (let b = a + 1; b <= 45; b++) {
    PAIR_INDEX[a * 46 + b] = PAIRS.length;
    PAIRS.push([a, b]);
    for (let c = b + 1; c <= 45; c++) {
      TRIPLE_INDEX[(a * 46 + b) * 46 + c] = TRIPLES.length;
      TRIPLES.push([a, b, c]);
    }
  }
}

export function overlap(a, b) {
  let hits = 0;
  let i = 0;
  let j = 0;
  while (i < 6 && j < 6) {
    if (a[i] === b[j]) { hits++; i++; j++; }
    else if (a[i] < b[j]) i++;
    else j++;
  }
  return hits;
}

export function drawFeatures(numbers, previous) {
  const runs = [];
  const ends = Array.from({ length: 10 }, () => []);
  const bands = new Uint8Array(5);
  let sequence = [];
  let longest = 1;
  let sum = 0;
  let odd = 0;
  for (const number of numbers) {
    if (sequence.length && number !== sequence.at(-1) + 1) {
      if (sequence.length > 1) runs.push(sequence);
      sequence = [];
    }
    sequence.push(number);
    longest = Math.max(longest, sequence.length);
    ends[number % 10].push(number);
    bands[Math.floor((number - 1) / 10)]++;
    sum += number;
    odd += number & 1;
  }
  if (sequence.length > 1) runs.push(sequence);
  return {
    sum, odd, runs, longest, bands: Array.from(bands),
    endMax: Math.max(...ends.map(group => group.length)),
    sameEnds: ends.filter(group => group.length > 1),
    repeated: previous ? numbers.filter(number => previous.includes(number)) : null,
  };
}

function sumDistribution() {
  const states = Array.from({ length: 7 }, () => new Float64Array(256));
  states[0][0] = 1;
  for (let number = 1; number <= 45; number++) {
    for (let count = Math.min(number, 6); count >= 1; count--) {
      for (let sum = number; sum <= 255; sum++) states[count][sum] += states[count - 1][sum - number];
    }
  }
  return states[6];
}

function longestRuns() {
  const atMost = [0];
  for (let cap = 1; cap <= 6; cap++) {
    let states = Array.from({ length: 7 }, () => new Float64Array(cap + 1));
    states[0][0] = 1;
    for (let number = 1; number <= 45; number++) {
      const next = Array.from({ length: 7 }, () => new Float64Array(cap + 1));
      for (let count = 0; count <= 6; count++) {
        for (let length = 0; length <= cap; length++) {
          next[count][0] += states[count][length];
          if (count < 6 && length < cap) next[count + 1][length + 1] += states[count][length];
        }
      }
      states = next;
    }
    atMost.push(states[6].reduce((sum, value) => sum + value, 0));
  }
  return atMost.map((value, length) => length ? value - atMost[length - 1] : 0);
}

function endDistribution() {
  const atMost = [0];
  for (let cap = 1; cap <= 5; cap++) {
    let counts = [1, 0, 0, 0, 0, 0, 0];
    for (let digit = 0; digit <= 9; digit++) {
      const size = digit >= 1 && digit <= 5 ? 5 : 4;
      const next = Array(7).fill(0);
      for (let taken = 0; taken <= 6; taken++) {
        for (let k = 0; k <= Math.min(cap, size, 6 - taken); k++) {
          next[taken + k] += counts[taken] * choose(size, k);
        }
      }
      counts = next;
    }
    atMost.push(counts[6]);
  }
  return atMost.map((value, k) => k ? value - atMost[k - 1] : 0);
}

const hypergeom = size => Array.from({ length: 7 }, (_, count) =>
  choose(size, count) * choose(45 - size, 6 - count) / DRAW_SPACE);
const probabilities = counts => Array.from(counts, count => count / DRAW_SPACE);
const sumCounts = sumDistribution();
export const THEORY = {
  number: 6 / 45,
  pair: choose(43, 4) / DRAW_SPACE,
  triple: choose(42, 3) / DRAW_SPACE,
  odd: hypergeom(23),
  sums: probabilities(sumCounts),
  sumBands: SUM_BANDS.map(([lo, hi]) => sumCounts.slice(lo, hi + 1).reduce((a, b) => a + b, 0) / DRAW_SPACE),
  runs: probabilities(longestRuns()),
  ends: probabilities(endDistribution()),
  overlap: hypergeom(6),
  bands: NUMBER_BANDS.map(([lo, hi]) => hypergeom(hi - lo + 1)),
};

export function selectWindow(ascending, range) {
  const rows = range === 'all' ? ascending.slice() : ascending.slice(-Number(range));
  const prior = ascending[ascending.length - rows.length - 1];
  return { rows, prior: prior?.round === rows[0]?.round - 1 ? prior : null };
}

function event(id, label, observed, n, p, criterion, value) {
  return { id, label, observed, n, p, expected: n * p, delta: observed - n * p, criterion, value };
}

export function referenceRange(row) {
  return row.n ? binomialRange(row.n, row.p) : null;
}

function upperMass(values, minimum) {
  return values.slice(minimum).reduce((sum, value) => sum + value, 0);
}

export function observePatterns({ rows, prior }) {
  const n = rows.length;
  if (!n) throw Error('분석할 회차가 없습니다.');
  const numberCounts = new Uint16Array(46);
  const pairCounts = new Uint16Array(PAIRS.length);
  const tripleCounts = new Uint16Array(TRIPLES.length);
  const odds = new Uint16Array(7);
  const sums = new Uint16Array(256);
  const runs = new Uint16Array(7);
  const ends = new Uint16Array(6);
  const overlaps = new Uint16Array(7);
  const bands = Array.from({ length: 5 }, () => new Uint16Array(7));
  const recent = new Map();
  const lastIntervals = new Map();
  const analyzed = [];
  let previous = prior;
  let comparable = 0;
  let totalSum = 0;
  let tailLength = 0;
  for (const row of rows) {
    const { numbers } = row;
    const consecutive = previous?.round === row.round - 1;
    const feature = drawFeatures(numbers, consecutive ? previous.numbers : null);
    analyzed.push({ ...row, feature });
    odds[feature.odd]++;
    sums[feature.sum]++;
    totalSum += feature.sum;
    runs[feature.longest]++;
    ends[feature.endMax]++;
    feature.bands.forEach((count, band) => bands[band][count]++);
    if (consecutive) {
      comparable++;
      overlaps[feature.repeated.length]++;
    }
    tailLength = consecutive && tailLength ? tailLength + 1 : 1;
    for (let i = 0; i < 6; i++) {
      const a = numbers[i];
      numberCounts[a]++;
      const lastSeen = recent.get(a);
      if (lastSeen !== undefined && lastSeen >= row.round - tailLength + 1) lastIntervals.set(a, row.round - lastSeen);
      else lastIntervals.delete(a);
      recent.set(a, row.round);
      for (let j = i + 1; j < 6; j++) {
        const ab = a * 46 + numbers[j];
        pairCounts[PAIR_INDEX[ab]]++;
        for (let k = j + 1; k < 6; k++) tripleCounts[TRIPLE_INDEX[ab * 46 + numbers[k]]]++;
      }
    }
    previous = row;
  }

  const last = rows.at(-1).round;
  const gapMean = (1 - THEORY.number) / THEORY.number;
  const tailStart = last - tailLength + 1;
  const gaps = Array.from({ length: 45 }, (_, index) => {
    const number = index + 1;
    const lastSeen = recent.get(number) ?? null;
    const censored = lastSeen === null || lastSeen < tailStart;
    const observed = censored ? tailLength : last - lastSeen;
    return {
      number, observed, lastSeen, censored, expected: gapMean, delta: observed - gapMean,
      lastInterval: lastIntervals.get(number) ?? null,
    };
  }).sort((a, b) => b.observed - a.observed || a.number - b.number);

  const combinationRows = (kind, values, combinations, probability) => combinations.map((numbers, index) =>
    event(`${kind}${index}`, numbers.join(' · '), values[index], n, probability, kind, numbers))
    .sort((a, b) => b.observed - a.observed);
  const groups = {
    numbers: Array.from({ length: 45 }, (_, index) =>
      event(`n${index + 1}`, `${index + 1}번`, numberCounts[index + 1], n, THEORY.number, 'numbers', index + 1)),
    odd: Array.from(odds, (count, k) => event(`o${k}`, `${k}:${6 - k}`, count, n, THEORY.odd[k], 'odd', k)),
    sum: SUM_BANDS.map(([lo, hi], index) => event(`s${index}`, `${lo}~${hi}`,
      sums.slice(lo, hi + 1).reduce((a, b) => a + b, 0), n, THEORY.sumBands[index], 'sumBand', [lo, hi])),
    run: Array.from(runs).slice(1).map((count, index) => event(`r${index + 1}`, index ? `${index + 1}개 연속` : '연속 없음',
      count, n, THEORY.runs[index + 1], 'run', index + 1)),
    end: Array.from(ends).slice(1).map((count, index) => event(`e${index + 1}`, index ? `${index + 1}개 동일` : '중복 없음',
      count, n, THEORY.ends[index + 1], 'end', index + 1)),
    overlap: Array.from(overlaps, (count, k) =>
      event(`v${k}`, `${k}개`, count, comparable, THEORY.overlap[k], 'overlap', k)),
    bands: NUMBER_BANDS.flatMap(([lo, hi], band) => Array.from(bands[band], (count, k) =>
      event(`b${band}-${k}`, `${lo}~${hi} 구간 · ${k}개`, count, n, THEORY.bands[band][k], 'bands', [band, k]))
      .filter(row => row.p > 0)),
    pairs: combinationRows('pairs', pairCounts, PAIRS, THEORY.pair),
    triples: combinationRows('triples', tripleCounts, TRIPLES, THEORY.triple),
    gaps,
  };
  const tests = [
    event('odd3', '홀수 3개·짝수 3개', odds[3], n, THEORY.odd[3], 'odd', 3),
    event('sum100', '합계 100~149', sums.slice(100, 150).reduce((a, b) => a + b, 0), n,
      THEORY.sums.slice(100, 150).reduce((a, b) => a + b, 0), 'sumBand', [100, 149]),
    event('run2', '연속번호 한 쌍 이상', upperMass(Array.from(runs), 2), n, upperMass(THEORY.runs, 2), 'runAtLeast', 2),
    event('run3', '3개 이상 연속', upperMass(Array.from(runs), 3), n, upperMass(THEORY.runs, 3), 'runAtLeast', 3),
    event('end2', '끝자리 중복 한 쌍 이상', upperMass(Array.from(ends), 2), n, upperMass(THEORY.ends, 2), 'endAtLeast', 2),
    event('over1', '직전 회차와 1개 이상 중복', upperMass(Array.from(overlaps), 1), comparable,
      upperMass(THEORY.overlap, 1), 'overlapAtLeast', 1),
    event('low3', '1~22번 3개·23~45번 3개', analyzed.filter(row =>
      row.numbers.filter(number => number <= 22).length === 3).length, n, hypergeom(22)[3], 'low', 3),
    event('maxNumber', '가장 많이 나온 번호', Math.max(...numberCounts), n, null, 'numbers', null),
    event('minNumber', '가장 적게 나온 번호', Math.min(...numberCounts.slice(1)), n, null, 'numbers', null),
    event('maxPair', '최다 번호쌍 · 990쌍 전체', groups.pairs[0].observed, n, null, 'pairs', groups.pairs[0].value),
    event('maxTriple', '최다 3개 조합 · 14,190개 전체', groups.triples[0].observed, n, null, 'triples', groups.triples[0].value),
    event('maxGap', '45개 번호 중 최장 미출현', gaps[0].observed, tailLength, null, 'gaps', gaps[0].number),
  ].filter(row => row.n > 0);
  for (const test of tests) if (test.p === null) { test.expected = null; test.delta = null; }
  groups.run.unshift(tests.find(row => row.id === 'run2'));
  groups.end.unshift(tests.find(row => row.id === 'end2'));
  if (comparable) groups.overlap.unshift(tests.find(row => row.id === 'over1'));
  return {
    n, first: rows[0].round, last, missing: last - rows[0].round + 1 - n,
    hasPrior: !!prior, comparable, tailLength, analyzed, groups, tests, averageSum: totalSum / n,
  };
}

export function matchingRounds(analysis, criterion, value) {
  return analysis.analyzed.filter(({ numbers, feature }) => {
    switch (criterion) {
      case 'numbers': return numbers.includes(value);
      case 'pairs': case 'triples': return value.every(number => numbers.includes(number));
      case 'odd': return feature.odd === value;
      case 'sumExact': return feature.sum === value;
      case 'sumBand': return feature.sum >= value[0] && feature.sum <= value[1];
      case 'run': return feature.longest === value;
      case 'runAtLeast': return feature.longest >= value;
      case 'end': return feature.endMax === value;
      case 'endAtLeast': return feature.endMax >= value;
      case 'overlap': return feature.repeated?.length === value;
      case 'overlapAtLeast': return feature.repeated !== null && feature.repeated.length >= value;
      case 'bands': return feature.bands[value[0]] === value[1];
      case 'low': return numbers.filter(number => number <= 22).length === value;
      default: return false;
    }
  });
}
