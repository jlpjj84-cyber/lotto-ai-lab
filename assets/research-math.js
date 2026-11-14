export const DRAW_SPACE = 8_145_060;
export const DEFAULT_SEED = 645;

export function choose(n, k) {
  if (k < 0 || n < k || n < 0) return 0;
  let value = 1;
  const terms = Math.min(k, n - k);
  for (let i = 1; i <= terms; i++) value = value * (n - i + 1) / i;
  return Math.round(value);
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleQuantile(sorted, p) {
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1))];
}

const binomialCache = new Map();

export function binomialRange(n, p) {
  if (!n || p === 0 || p === 1) return [n * p, n * p];
  const key = `${n}:${p}`;
  if (binomialCache.has(key)) return binomialCache.get(key);
  // Relative masses around the mode avoid underflow when P(X=0) is tiny.
  const weights = new Float64Array(n + 1);
  const mode = Math.floor((n + 1) * p);
  weights[mode] = 1;
  let total = 1;
  for (let i = mode; i > 0; i--) {
    weights[i - 1] = weights[i] * i * (1 - p) / ((n - i + 1) * p);
    total += weights[i - 1];
  }
  for (let i = mode; i < n; i++) {
    weights[i + 1] = weights[i] * (n - i) * p / ((i + 1) * (1 - p));
    total += weights[i + 1];
  }
  let cumulative = 0;
  let lower = null;
  let upper = n;
  for (let i = 0; i <= n; i++) {
    cumulative += weights[i];
    if (lower === null && cumulative >= total * .025) lower = i;
    if (cumulative >= total * .975) {
      upper = i;
      break;
    }
  }
  const range = [lower, upper];
  if (binomialCache.size >= 512) binomialCache.clear();
  binomialCache.set(key, range);
  return range;
}

export function holm(pValues, scopes = 1) {
  const sorted = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = [];
  let previous = 0;
  sorted.forEach(({ p, index }, rank) => {
    previous = Math.max(previous, Math.min(1, p * (sorted.length - rank) * scopes));
    adjusted[index] = previous;
  });
  return adjusted;
}

export function hitProbabilities() {
  return Array.from({ length: 7 }, (_, hits) => choose(6, hits) * choose(39, 6 - hits) / DRAW_SPACE);
}
