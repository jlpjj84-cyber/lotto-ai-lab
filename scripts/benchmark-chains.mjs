// Reproduce the fixed 1–1250 study without changing data or prediction files.
import { readFile, writeFile } from 'node:fs/promises';
import { analyzeChains, transitionMatrix } from '../assets/chain-research.js';
import { validateChains } from '../assets/chain-validation.js';
import { datasetStamp } from '../assets/research-provenance.js';

const rows = JSON.parse(await readFile(new URL('../data/draws.json', import.meta.url))).draws.filter(row => row.round <= 1250);
const repetitions = Number(process.argv[2] || 10000);
const fixed = analyzeChains(rows);
const mc = validateChains(rows, fixed, repetitions);
const walk = analyzeChains(rows, { mode: 'walk-forward' });
const { rounds: fixedRounds, ...fixedSummary } = fixed.forecast;
const { rounds: walkRounds, ...walkSummary } = walk.forecast;
const output = { version: fixed.version, scope: 'historical split, not prospective evidence',
  settings: fixed.settings, source: await datasetStamp(rows), runtime: { node: process.version,
    fixedMs: fixed.durationMs, walkForwardMs: walk.durationMs, monteCarloMs: mc.durationMs },
  search: { ...fixed.discovery, candidates: undefined }, patterns: fixed.patterns.map((p, i) => ({
    chain: p.chain.stages, gaps: p.chain.gaps, discovery: { successes: p.discovery.successes,
      trials: p.discovery.trials, expected: p.discovery.expected }, evaluation: { successes: p.evaluation.successes,
      trials: p.evaluation.trials, probability: p.evaluation.probability, effect: p.evaluation.effect,
      interval: p.evaluation.interval, adjustedP: p.evaluation.adjustedP }, mc: mc.patterns[i] })),
  forecast: { fixed: fixedSummary, walkForward: walkSummary }, monteCarlo: { ...mc, patterns: undefined },
  transitions: Array.from({ length: 10 }, (_, i) => {
    const matrix = transitionMatrix(rows, i + 1, 1, 1000);
    let best = 0; matrix.counts.forEach((count, j) => { if (count > matrix.counts[best]) best = j; });
    return { lag: i + 1, windows: matrix.windows, largestCount: matrix.counts[best],
      pair: [Math.floor(best / 45) + 1, best % 45 + 1], expected: matrix.expectedJoint,
      interpretation: 'discovery-only, selected maximum is not a significance test' };
  }) };
if (process.argv[3]) {
  await writeFile(process.argv[3], JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ output: process.argv[3], runtime: output.runtime, patterns: output.patterns.length,
    fixedDifference: fixedSummary.difference, walkForwardDifference: walkSummary.difference }));
} else console.log(JSON.stringify(output, null, 2));
