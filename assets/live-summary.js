import { DEFAULT_SEED, seededRandom } from './research-math.js';
import { bootstrapRoundMean, EXPECTED_MATCHES } from './research-backtest.js';
import { GAMES_PER_DRAW, STRATEGIES } from './lotto-strategies.js';

export const MIN_LIVE_ROUNDS = 20;

export function summarizeLive(evaluations) {
  const rows = evaluations.slice().sort((a, b) => a.round - b.round);
  const randomIndex = STRATEGIES.findIndex(([id]) => id === 'random');
  if (rows.some((row, index) => row.round === rows[index - 1]?.round || row.strategies?.length !== STRATEGIES.length ||
      row.strategies.some((strategy, i) => strategy.id !== STRATEGIES[i][0] || strategy.games?.length !== GAMES_PER_DRAW))) {
    throw Error('평가 표본의 회차 또는 전략별 게임 수가 일치하지 않습니다.');
  }
  return {
    rounds: rows.map(row => row.round),
    strategies: STRATEGIES.map(([id, label], i) => {
      const hitCounts = Array(7).fill(0);
      const ranks = Array(6).fill(0);
      const points = [];
      const differences = [];
      const trend = [];
      let hits = 0, spent = 0, prize = 0, unpriced = 0, randomHits = 0;
      for (const row of rows) {
        const score = row.strategies[i];
        const baseline = row.strategies[randomIndex];
        points.push(score.totalHits / GAMES_PER_DRAW);
        differences.push((score.totalHits - baseline.totalHits) / GAMES_PER_DRAW);
        hits += score.totalHits;
        spent += score.spent;
        prize += score.prize;
        unpriced += score.unpriced;
        randomHits += baseline.totalHits;
        score.hits.forEach((value, k) => { hitCounts[k] += value; });
        score.ranks.forEach((value, k) => { ranks[k] += value; });
        trend.push({ round: row.round, mean: hits / (points.length * GAMES_PER_DRAW) });
      }
      const games = rows.length * GAMES_PER_DRAW;
      const knownMoney = games > 0 && unpriced === 0;
      return {
        id, label, draws: rows.length, games, hits: hitCounts, ranks, spent, prize, unpriced,
        net: knownMoney ? prize - spent : null,
        roi: knownMoney ? (prize - spent) / spent : null,
        mean: games ? hits / games : null,
        theoreticalDelta: games ? hits / games - EXPECTED_MATCHES : null,
        pairedDelta: games ? (hits - randomHits) / games : null,
        interval: bootstrapRoundMean(points, seededRandom(DEFAULT_SEED + i)),
        pairedInterval: bootstrapRoundMean(differences, seededRandom(DEFAULT_SEED + 100 + i)),
        trend,
      };
    }),
  };
}
