import { holm, sampleQuantile } from './research-math.js';
import { fairDraw, fairNumberSource } from './research-simulation.js';
import { bernoulliLogE } from './chain-math.js';
import { antecedentMatches, chainSettings, cleanChainRows, compileChain, numberMask, observeChain, rowIndex } from './chain-research.js';

export const MONTE_CARLO_BUDGET = 300000000;

export function simulationWork(patterns, evaluationDraws, repetitions) {
  return repetitions * evaluationDraws * patterns.reduce((sum, p) => sum + p.chain.stages.length, 0);
}

// Discovery is conditioned on and frozen. Only independent evaluation draws
// are randomized; the actual discovery boundary context and missing IDs remain.
export function validateChains(input, analysis, repetitions = 10000, progress = () => {}) {
  if (!Number.isInteger(repetitions) || repetitions < 20 || repetitions > 100000) throw Error('반복 수는 20~100,000 정수여야 합니다.');
  const started = performance.now(), settings = chainSettings(analysis.settings);
  const patterns = analysis.patterns;
  if (!patterns.length) return { repetitions: 0, patterns: [], reason: '검증할 발견 후보가 없습니다.', durationMs: 0 };
  const rows = cleanChainRows(input).filter(row => row.round <= settings.endRound);
  const evaluationRows = rows.filter(row => row.round > settings.developmentEnd);
  if (!evaluationRows.length) throw Error('독립 평가 구간이 없어 검증 대기 상태입니다.');
  const work = simulationWork(patterns, evaluationRows.length, repetitions);
  if (work > MONTE_CARLO_BUDGET) throw Error(`예상 연산량 ${work.toLocaleString()}이 안전 한도 ${MONTE_CARLO_BUDGET.toLocaleString()}을 넘습니다. 후보 수·연쇄 길이·평가 기간을 줄이거나 10,000회 검정을 이용해 주세요.`);
  // Reject a mismatched family rather than silently validating altered input.
  const index = rowIndex(rows);
  for (const pattern of patterns) {
    const compiled = compileChain(pattern.chain.stages, pattern.chain.gaps);
    if (JSON.stringify(compiled) !== JSON.stringify(pattern.chain)) throw Error('후보 구조 무결성 검증 실패');
    const observed = observeChain(index, compiled, settings.developmentEnd + 1, settings.endRound, false);
    if (observed.trials !== pattern.evaluation.trials || observed.successes !== pattern.evaluation.successes ||
        Math.abs(observed.logE - pattern.evaluation.logE) > 1e-10) throw Error('평가 데이터가 원래 분석과 일치하지 않습니다. 분석을 다시 실행해 주세요.');
  }
  const next = fairNumberSource(settings.seed ^ 0xc4a152), picked = new Uint8Array(6);
  const observed = patterns.map(p => p.evaluation.logE);
  const tails = patterns.map(() => 0), maxTails = patterns.map(() => 0);
  const rates = patterns.map(() => []), statistics = patterns.map(() => []);
  const maxima = [];
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const row of evaluationRows) {
      fairDraw(next, picked);
      index.set(row.round, { round: row.round, ...numberMask(picked) });
    }
    let maximum = -Infinity;
    patterns.forEach(({ chain }, i) => {
      let trials = 0, successes = 0;
      for (const row of evaluationRows) {
        const start = row.round - chain.span;
        // Same eligible windows as observation, including missing-round rules.
        if (!chain.offsets.every(offset => index.has(start + offset)) || !antecedentMatches(index, chain, row.round)) continue;
        trials++;
        const outcome = index.get(row.round), mask = chain.masks.at(-1);
        if ((outcome.low & mask.low) === mask.low && (outcome.high & mask.high) === mask.high) successes++;
      }
      const statistic = bernoulliLogE(successes, trials, chain.nullProbability);
      statistics[i].push(statistic);
      if (trials) rates[i].push(successes / trials);
      if (statistic >= observed[i] - 1e-12) tails[i]++;
      maximum = Math.max(maximum, statistic);
    });
    maxima.push(maximum);
    for (let i = 0; i < patterns.length; i++) if (maximum >= observed[i] - 1e-12) maxTails[i]++;
    if ((repeat + 1) % 20 === 0 || repeat + 1 === repetitions) progress((repeat + 1) / repetitions);
  }
  const pValues = tails.map(tail => (tail + 1) / (repetitions + 1)), adjusted = holm(pValues);
  const range = values => {
    values.sort((a, b) => a - b);
    return values.length ? [sampleQuantile(values, .025), sampleQuantile(values, .975)] : null;
  };
  return { repetitions, seed: settings.seed, work, durationMs: performance.now() - started,
    method: '발견 후보 고정 · 평가 구간 비복원 6/45 재생성 · 전체 후보 최댓값 보정',
    maximumRange: range(maxima), patterns: patterns.map((pattern, i) => {
      const familyP = (maxTails[i] + 1) / (repetitions + 1);
      const enough = pattern.evaluation.trials >= 20;
      return { id: pattern.chain.id, pValue: pValues[i], adjustedP: adjusted[i], familyP,
        rateRange: range(rates[i]), rateSamples: rates[i].length, statisticRange: range(statistics[i]),
        verdict: !enough ? '표본 부족' : pattern.evaluation.effect > 0 && pattern.evaluation.adjustedP <= .05 &&
          familyP <= .05 && adjusted[i] <= .05 ? '검증 통과 · 미래 재검증 필요' : '미통과' };
    }) };
}
