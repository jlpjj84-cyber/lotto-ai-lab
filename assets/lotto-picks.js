(function (global) {
  'use strict';

  const allNumbers = Array.from({ length: 45 }, (_, index) => index + 1);

  function uniformLine(random = Math.random, available = allNumbers, decisions) {
    const pool = available.slice();
    for (let index = 0; index < 6; index++) {
      const other = index + Math.floor(random() * (pool.length - index));
      [pool[index], pool[other]] = [pool[other], pool[index]];
      if (decisions) decisions.push({ number: pool[index], pool: pool.length - index });
    }
    return pool.slice(0, 6).sort((a, b) => a - b);
  }

  function weightedPick(pool, weight, total, random) {
    let remaining = random() * total;
    for (const number of pool) {
      remaining -= weight(number);
      if (remaining < 0) return number;
    }
    return pool.at(-1);
  }

  function generateManual({ mode, unique, counts, random = Math.random, available = allNumbers, games = 4, trace }) {
    const used = new Set();
    const result = [];
    const weight = mode === 'hot' ? number => (counts[number] + 2) ** 2
      : mode === 'cold' ? number => (60 - counts[number]) ** 2 : null;
    for (let game = 0; game < games; game++) {
      const numbers = [];
      const pool = available.filter(number => !unique || !used.has(number));
      const decisions = trace ? [] : null;
      for (let position = 0; position < 6; position++) {
        const total = weight ? pool.reduce((sum, number) => sum + weight(number), 0) : pool.length;
        const number = weight ? weightedPick(pool, weight, total, random)
          : pool[Math.floor(random() * pool.length)];
        if (decisions) decisions.push({ number, pool: pool.length,
          ...(weight ? { count: counts[number], weight: weight(number), total } : {}) });
        pool.splice(pool.indexOf(number), 1);
        numbers.push(number);
        used.add(number);
      }
      result.push(numbers.sort((a, b) => a - b));
      if (trace) trace.push({ method: weight ? mode : 'uniform', pool: decisions[0].pool,
        disjoint: unique, decisions });
    }
    return result;
  }

  function generate({ random = Math.random, ...options }) {
    return [...generateManual({ ...options, random }), uniformLine(random)];
  }

  global.LottoPicks = Object.freeze({ generate, generateManual, uniformLine });
})(globalThis);
