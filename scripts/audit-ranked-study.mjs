import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { AutomaticChainState } from '../assets/chain-auto.js';
import { createAutoSnapshot } from '../assets/chain-auto-record.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-11, `${a} != ${b}`);
const group = c => c.stages.length === 1 ? (c.stages[0].length === 1 ? 'transition' : 'same-draw-set') :
  c.stages.some(s => s.length > 1) ? 'mixed-set-chain' : 'temporal-chain';

// Independent arithmetic and selection oracle: does not import the scoring or
// selection functions under audit. Current context counts can be rebuilt from
// original draws rather than trusting the stored success/trial fields.
function oracleScores(entries, settings, rows) {
  const groups = new Map(), index = rows && new Map(rows.map(row => [row.round, new Set(row.numbers)]));
  for (const entry of entries) {
    let trials = entry.trials, counts = entry.counts;
    if (rows) {
      const targets = rows.filter(row => entry.lags.every((lag, i) => entry.stages[i].every(n => index.get(row.round - lag)?.has(n))));
      trials = targets.length; counts = Array(46).fill(0);
      for (const row of targets) for (const n of row.numbers) counts[n]++;
      assert.equal(entry.trials, trials); assert.deepEqual([...entry.counts], counts);
    }
    const name = group(entry);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ trials, counts });
  }
  const scored = Array.from({ length: 45 }, (_, i) => {
    let score = 0;
    for (const entries of groups.values()) {
      let numerator = 0, denominator = 0;
      for (const row of entries) {
        const reliability = row.trials / (row.trials + settings.shrinkage);
        numerator += reliability * (row.counts[i + 1] - row.trials * 2 / 15) / (row.trials + settings.shrinkage);
        denominator += reliability;
      }
      score += numerator / denominator / groups.size * 100;
    }
    return { number: i + 1, score, rank: 0 };
  });
  [...scored].sort((a, b) => b.score - a.score || a.number - b.number).forEach((r, i) => { r.rank = i + 1; });
  return scored;
}
function oracleGames(scored, strength) {
  const uses = Array(46).fill(0), lines = [], records = [];
  const scale = (Math.max(...scored.map(r => r.score)) - Math.min(...scored.map(r => r.score))) * strength;
  for (let game = 0; game < 5; game++) {
    const ordered = scored.map(row => ({ ...row, priorUses: uses[row.number], diversityPenalty: scale * uses[row.number],
      selectionScore: row.score - scale * uses[row.number] })).sort((a, b) => b.selectionScore - a.selectionScore ||
        a.priorUses - b.priorUses || b.score - a.score || a.number - b.number);
    const selected = ordered.slice(0, 6);
    records.push({ ordered, scale, selected });
    lines.push(selected.map(r => r.number).sort((a, b) => a - b));
    selected.forEach(r => { uses[r.number]++; });
  }
  return { lines, records };
}

export function auditRankedStudy(snapshot, input) {
  const result = snapshot.result, rows = [...input].sort((a, b) => a.round - b.round);
  assert.equal(result.data.count, rows.length); assert.equal(rows[0].round, 1);
  assert.equal(result.model.scores.length, 45);
  const state = new AutomaticChainState(result.settings), saved = new Map(result.validation.rounds.map(r => [r.round, r]));
  let evaluated = 0;
  for (const row of rows) {
    const prepared = state.prepare(row.round);
    if (saved.has(row.round)) {
      const stored = saved.get(row.round), independent = oracleScores([...prepared.contexts.values()].filter(Boolean), result.settings);
      independent.forEach((s, i) => close(s.score, stored.scoreVector[i]));
      assert.deepEqual(oracleGames(independent, result.settings.diversityStrength).lines, stored.experimental);
      assert.equal(stored.through, row.round - 1); assert.equal(stored.games, 5); evaluated++;
    }
    state.append(row, prepared);
  }
  const prepared = state.prepare(rows.at(-1).round + 1), active = [...prepared.contexts.values()].filter(Boolean);
  const scores = oracleScores(active, result.settings, rows), expected = oracleGames(scores, result.settings.diversityStrength);
  result.model.scores.forEach((s, i) => { close(s.score, scores[i].score); assert.equal(s.rank, scores[i].rank); });
  assert.deepEqual(expected.lines, result.recommendation.lines);
  const positions = [];
  for (const [i, trace] of result.recommendation.trace.entries()) {
    assert.equal(trace.method, 'ranked'); assert.equal(trace.shared, false); assert.equal(trace.preGameScores.length, 45);
    assert.equal(trace.decisions.length, 6); close(trace.diversityScale, expected.records[i].scale);
    const remaining = expected.records[i].ordered.map(r => r.number);
    for (const [step, d] of trace.decisions.entries()) {
      const selected = expected.records[i].selected[step];
      assert.equal(d.number, selected.number); assert.equal(d.rank, selected.rank); close(d.score, selected.score);
      close(d.selectionScore, selected.selectionScore); close(d.diversityPenalty, selected.diversityPenalty);
      assert.equal(d.priorUses, selected.priorUses); assert.deepEqual(d.remainingCandidates, remaining);
      assert.equal(d.number, remaining.shift()); assert.equal(d.pool, 45 - step);
      const scored = result.model.scores[d.number - 1];
      assert.deepEqual(d.influences, scored.contributorIds);
      const relations = d.influences.map(id => result.model.candidates.find(p => p.id === id));
      for (const p of relations) {
        assert.equal(p.number, d.number); assert.equal(p.through, rows.at(-1).round);
        const matching = rows.filter(row => p.context.lags.every((lag, j) => p.context.stages[j].every(n =>
          state.index.get(row.round - lag)?.numbers.includes(n))));
        assert.equal(p.trials, matching.length); assert.equal(p.successes, matching.filter(r => r.numbers.includes(d.number)).length);
      }
      positions.push({ game: i + 1, position: step + 1, number: d.number, score: d.score, rank: d.rank,
        priorUses: d.priorUses, diversityPenalty: d.diversityPenalty, selectionScore: d.selectionScore,
        relations: relations.map(p => ({ id: p.id, successes: p.successes, trials: p.trials, contribution: p.contribution,
          registeredTrials: p.validation.trials, status: p.validation.status })) });
    }
  }
  assert.equal(positions.length, 30);
  const selectorSource = readFileSync(new URL('../assets/chain-ranking.js', import.meta.url), 'utf8');
  assert.doesNotMatch(selectorSource, /Math\.random|randomFor|seededRandom|uniformLine|weightedPick|generateControlGames/);
  return { version: result.version, data: snapshot.data, passed: true, scoresVerified: 45, positionsVerified: 30,
    currentConditionsRecounted: active.length, walkForwardDrawsVerified: evaluated, rankingModuleHasNoRng: true,
    lines: result.recommendation.lines, scores: result.model.scores, positions,
    validation: { ...result.validation, rounds: undefined }, durationMs: result.durationMs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const rows = JSON.parse(readFileSync(new URL('../data/draws.json', import.meta.url))).draws;
  const snapshot = await createAutoSnapshot(rows), report = auditRankedStudy(snapshot, rows);
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, scores: report.scoresVerified, positions: report.positionsVerified,
    conditions: report.currentConditionsRecounted, evaluated: report.walkForwardDrawsVerified, games: report.lines, validation: report.validation }));
}
