import { DEFAULT_SEED, holm, seededRandom } from './research-math.js';
import { PAIRS, PAIR_INDEX, TRIPLES, TRIPLE_INDEX } from './research-patterns.js';

export const SIMULATION_COUNTS = [10_000, 100_000];
const SELECTABLE_TEST_SCOPES = 4 * SIMULATION_COUNTS.length;
const UINT32_SPACE = 2 ** 32;
const UNIFORM_LIMIT = UINT32_SPACE - UINT32_SPACE % 45;

function rng32(seed) {
  const random = seededRandom(seed);
  return () => {
    let value;
    do { value = random() * UINT32_SPACE; } while (value >= UNIFORM_LIMIT);
    return 1 + value % 45;
  };
}

function draw(next, picked) {
  let low = 0;
  let high = 0;
  let count = 0;
  while (count < 6) {
    const number = next();
    const bit = 1 << ((number - 1) & 31);
    if (number <= 32) {
      if (low & bit) continue;
      low |= bit;
    } else {
      if (high & bit) continue;
      high |= bit;
    }
    let i = count;
    while (i > 0 && picked[i - 1] > number) {
      picked[i] = picked[i - 1];
      i--;
    }
    picked[i] = number;
    count++;
  }
}

const ABOVE = new Set(['maxNumber', 'maxPair', 'maxTriple', 'maxGap']);

export function simulatePatterns({ rounds, hasPrior, tests, tailLength, repetitions, seed = DEFAULT_SEED }, progress = () => {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100_000 || !rounds.length || rounds.length > 9999) {
    throw Error('회차 또는 반복 횟수를 확인해 주세요.');
  }
  const n = rounds.length;
  const transitions = rounds.map((round, index) => index === 0 ? hasPrior : rounds[index - 1] === round - 1);
  const next = rng32(seed);
  const picked = new Uint8Array(6);
  const counts = new Uint16Array(46);
  const pairCounts = new Uint16Array(PAIRS.length);
  const tripleCounts = new Uint16Array(TRIPLES.length);
  const latest = new Int32Array(46);
  const histories = tests.map(() => new Uint32Array(n + 1));

  for (let rep = 0; rep < repetitions; rep++) {
    counts.fill(0);
    pairCounts.fill(0);
    tripleCounts.fill(0);
    latest.fill(-1);
    let lastLow = 0, lastHigh = 0;
    if (hasPrior) {
      draw(next, picked);
      for (const number of picked) {
        if (number <= 32) lastLow |= 1 << (number - 1);
        else lastHigh |= 1 << (number - 33);
      }
    }
    let odd3 = 0, sum100 = 0, run2 = 0, run3 = 0, end2 = 0, over1 = 0, low3 = 0;
    let maxPair = 0, maxTriple = 0;

    for (let i = 0; i < n; i++) {
      draw(next, picked);
      let low = 0, high = 0, sum = 0, odd = 0, small = 0, digits = 0;
      let run = 1, longest = 1;
      for (let j = 0; j < 6; j++) {
        const a = picked[j];
        counts[a]++;
        latest[a] = i;
        if (a <= 32) low |= 1 << (a - 1);
        else high |= 1 << (a - 33);
        odd += a & 1;
        sum += a;
        small += a <= 22;
        const digitBit = 1 << (a % 10);
        // Reserve the upper bit as a marker for any repeated last digit.
        if (digits & digitBit) digits |= 1024;
        digits |= digitBit;
        run = j > 0 && a === picked[j - 1] + 1 ? run + 1 : 1;
        if (run > longest) longest = run;
        for (let k = j + 1; k < 6; k++) {
          const ab = a * 46 + picked[k];
          const pair = ++pairCounts[PAIR_INDEX[ab]];
          if (pair > maxPair) maxPair = pair;
          for (let l = k + 1; l < 6; l++) {
            const triple = ++tripleCounts[TRIPLE_INDEX[ab * 46 + picked[l]]];
            if (triple > maxTriple) maxTriple = triple;
          }
        }
      }
      odd3 += odd === 3;
      sum100 += sum >= 100 && sum <= 149;
      run2 += longest >= 2;
      run3 += longest >= 3;
      end2 += (digits & 1024) !== 0;
      over1 += transitions[i] && ((low & lastLow) !== 0 || (high & lastHigh) !== 0);
      low3 += small === 3;
      lastLow = low;
      lastHigh = high;
    }

    let maxNumber = 0, minNumber = n, maxGap = 0;
    for (let number = 1; number <= 45; number++) {
      maxNumber = Math.max(maxNumber, counts[number]);
      minNumber = Math.min(minNumber, counts[number]);
      maxGap = Math.max(maxGap, Math.min(tailLength, n - 1 - latest[number]));
    }
    const values = { odd3, sum100, run2, run3, end2, over1, low3, maxNumber, minNumber, maxPair, maxTriple, maxGap };
    tests.forEach(({ id }, index) => histories[index][values[id]]++);
    if ((rep + 1) % 256 === 0 || rep + 1 === repetitions) progress(rep + 1, repetitions);
  }

  const rows = tests.map((test, index) => {
    let extreme = 0, cumulative = 0, total = 0;
    let lower = null, upper = null;
    const observedDistance = Math.abs(test.observed - test.expected);
    histories[index].forEach((count, value) => {
      if (ABOVE.has(test.id) ? value >= test.observed : test.id === 'minNumber' ? value <= test.observed
        : Math.abs(value - test.expected) >= observedDistance - 1e-10) extreme += count;
      total += value * count;
      cumulative += count;
      if (lower === null && cumulative >= repetitions * .025) lower = value;
      if (upper === null && cumulative >= repetitions * .975) upper = value;
    });
    return { ...test, range: [lower, upper], simulatedMean: total / repetitions, pValue: (extreme + 1) / (repetitions + 1) };
  });
  const adjusted = holm(rows.map(row => row.pValue), SELECTABLE_TEST_SCOPES);
  return { repetitions, seed, rows: rows.map((row, i) => ({ ...row, adjusted: adjusted[i] })) };
}

export function patternJob(window, analysis, repetitions, seed) {
  return { rounds: window.rows.map(row => row.round), hasPrior: analysis.hasPrior,
    tests: analysis.tests, tailLength: analysis.tailLength, repetitions, seed };
}
