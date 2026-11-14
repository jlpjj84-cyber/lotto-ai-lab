(function (global) {
  'use strict';

  const allNumbers = Array.from({ length: 45 }, (_, index) => index + 1);

  function uniformLine(random = Math.random, available = allNumbers) {
    const pool = available.slice();
    for (let index = 0; index < 6; index++) {
      const other = index + Math.floor(random() * (pool.length - index));
      [pool[index], pool[other]] = [pool[other], pool[index]];
    }
    return pool.slice(0, 6).sort((a, b) => a - b);
  }

  function weightedPick(pool, weight, random) {
    let remaining = random() * pool.reduce((sum, number) => sum + weight(number), 0);
    for (const number of pool) {
      remaining -= weight(number);
      if (remaining < 0) return number;
    }
    return pool.at(-1);
  }

  function generateManual({ mode, unique, counts, random = Math.random, available = allNumbers, games = 4 }) {
    const used = new Set();
    const result = [];
    const weight = mode === 'hot' ? number => (counts[number] + 2) ** 2
      : mode === 'cold' ? number => (60 - counts[number]) ** 2 : null;
    for (let game = 0; game < games; game++) {
      const numbers = [];
      const pool = available.filter(number => !unique || !used.has(number));
      for (let position = 0; position < 6; position++) {
        const number = weight ? weightedPick(pool, weight, random)
          : pool[Math.floor(random() * pool.length)];
        pool.splice(pool.indexOf(number), 1);
        numbers.push(number);
        used.add(number);
      }
      result.push(numbers.sort((a, b) => a - b));
    }
    return result;
  }

  function generate({ random = Math.random, ...options }) {
    return [...generateManual({ ...options, random }), uniformLine(random)];
  }

  global.LottoPicks = Object.freeze({ generate, generateManual, uniformLine });
})(globalThis);
