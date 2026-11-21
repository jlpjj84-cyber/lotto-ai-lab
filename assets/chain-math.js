import { choose, DRAW_SPACE } from './research-math.js';

export const SINGLE_PROBABILITY = 6 / 45;
// Fixed, two-sided alternatives; never fitted to the evaluation outcomes.
const TILTS = [-4, -2, -1, -.5, -.25, -.125, .125, .25, .5, 1, 2, 4];
export const FORECAST_TILTS = [.05, .1, .25, .5, 1];

export const inclusionProbability = size => choose(6, size) / choose(45, size);
export function logMeanExp(values) {
  const maximum = Math.max(...values);
  return maximum + Math.log(values.reduce((sum, value) => sum + Math.exp(value - maximum), 0) / values.length);
}

// The trigger is known before the target draw. This likelihood mixture remains
// a martingale under the fair null even when trigger windows overlap.
export function bernoulliLogE(successes, trials, probability = SINGLE_PROBABILITY) {
  if (!trials) return 0;
  return logMeanExp(TILTS.map(tilt => tilt * successes - trials * Math.log1p(probability * Math.expm1(tilt))));
}
export const eToP = logE => Math.min(1, Math.exp(-logE));

// Inversion gives a confidence sequence under a constant conditional success
// probability, not an iid binomial interval over overlapping windows.
export function conditionalInterval(successes, trials, alpha = .05) {
  if (!trials) return [0, 1];
  const mean = successes / trials;
  const boundary = -Math.log(alpha);
  const excluded = q => bernoulliLogE(successes, trials, q) >= boundary;
  const search = (a, b, lower) => {
    for (let step = 0; step < 48; step++) {
      const middle = (a + b) / 2;
      if (excluded(middle) === lower) a = middle; else b = middle;
    }
    return (a + b) / 2;
  };
  return [successes === 0 || !excluded(0) ? 0 : search(0, mean, true),
    successes === trials || !excluded(1) ? 1 : search(mean, 1, false)];
}

const mgfCache = new Map();
// Exact MGF for a single shared fair 6/45 outcome and signed ticket counts.
// Treating the five games as independent would understate uncertainty.
export function pairedLogMgfs(experimental, baseline) {
  const counts = new Int8Array(46);
  for (const line of experimental) for (const number of line) counts[number]++;
  for (const line of baseline) for (const number of line) counts[number]--;
  const multiplicities = new Uint8Array(11);
  for (let number = 1; number <= 45; number++) multiplicities[counts[number] + 5]++;
  const key = multiplicities.join(',');
  if (mgfCache.has(key)) return mgfCache.get(key);
  const result = FORECAST_TILTS.map(tilt => {
    const sums = new Float64Array(7);
    sums[0] = 1;
    for (let count = -5; count <= 5; count++) {
      const weight = Math.exp(tilt * count / 5);
      for (let copy = 0; copy < multiplicities[count + 5]; copy++) {
        for (let k = 6; k > 0; k--) sums[k] += sums[k - 1] * weight;
      }
    }
    return Math.log(sums[6] / DRAW_SPACE);
  });
  if (mgfCache.size >= 2048) mgfCache.clear();
  mgfCache.set(key, result);
  return result;
}
