import { overlap } from './research-patterns.js';

export function scoreGame(numbers, draw) {
  const matches = overlap(numbers, draw.numbers);
  const bonus = numbers.includes(draw.bonus);
  const rank = matches === 6 ? 1 : matches === 5 ? (bonus ? 2 : 3) : matches === 4 ? 4 : matches === 3 ? 5 : null;
  const amount = draw.prizes?.[rank];
  const prize = rank === null ? 0 : Number.isSafeInteger(amount) && amount > 0 ? amount : null;
  return { matches, bonus, rank, prize };
}

export function scoreTickets(tickets, draw) {
  const hits = Array(7).fill(0);
  const ranks = Array(6).fill(0);
  const games = tickets.map(numbers => scoreGame(numbers, draw));
  let prize = 0, unpriced = 0, totalHits = 0;
  for (const game of games) {
    hits[game.matches]++;
    totalHits += game.matches;
    if (game.rank) ranks[game.rank]++;
    if (game.prize === null) unpriced++;
    else prize += game.prize;
  }
  // The game price was halved starting with draw 88 (2004-08-07).
  return { hits, ranks, games, totalHits, prize, unpriced, spent: tickets.length * (draw.round >= 88 ? 1000 : 2000) };
}
