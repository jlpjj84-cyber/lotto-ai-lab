import { newHistory, picksFor, randomFor } from './lotto-strategies.js';

// Randomness is isolated in the explicitly selected comparison arm.
export function generateControlGames(target, { seed = 645, games = 5, uniqueLines = false, spread = false } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(games) || games < 1 || games > 20 ||
    typeof uniqueLines !== 'boolean' || typeof spread !== 'boolean') throw Error('무작위 대조군 옵션 오류');
  if (spread && games > 7) throw Error('번호를 모두 분산하면 최대 7게임입니다.');
  if (games === 5 && !uniqueLines && !spread) {
    const original = [], lines = picksFor(newHistory(), target, 8, seed, original);
    return { lines, mode: 'control', trace: original.map(t => ({ method: 'uniform-control', role: 'random-control', shared: false,
      decisions: t.decisions.map(d => ({ number: d.number, pool: d.pool, selectionProbability: 1 / d.pool, influences: [] })) })) };
  }
  const lines = [], trace = [], seen = new Set(); let available = Array.from({ length: 45 }, (_, i) => i + 1);
  for (let attempt = 0; attempt < 1024 && lines.length < games; attempt++) {
    const decisions = [], line = globalThis.LottoPicks.uniformLine(randomFor(target, 1000 + attempt, seed), available, decisions);
    if (uniqueLines && seen.has(line.join(','))) continue;
    seen.add(line.join(',')); lines.push(line);
    trace.push({ method: 'uniform-control', role: 'random-control', shared: false,
      decisions: decisions.map(d => ({ ...d, selectionProbability: 1 / d.pool, influences: [] })) });
    if (spread) available = available.filter(n => !line.includes(n));
  }
  if (lines.length !== games) throw Error('대조군 중복 제한을 만족하지 못했습니다.');
  return { lines, trace, mode: 'control' };
}
