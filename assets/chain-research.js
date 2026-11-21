import { holm, seededRandom } from './research-math.js';
import { addDraw, newHistory, picksFor, randomFor } from './lotto-strategies.js';
import { bootstrapRoundMean } from './research-backtest.js';
import { bernoulliLogE, conditionalInterval, eToP, FORECAST_TILTS, inclusionProbability,
  logMeanExp, pairedLogMgfs, SINGLE_PROBABILITY } from './chain-math.js';

export const CHAIN_VERSION = '5.2.0';
export const DEFAULT_CHAIN_SETTINGS = Object.freeze({ developmentEnd: 1000, endRound: 1250,
  maxLength: 10, gap: 1, minSupport: 8, topK: 12, maxNodes: 150000, seed: 645, mode: 'fixed' });

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw Error(`${name}: ${minimum}~${maximum} 정수가 필요합니다.`);
  return value;
}
export function chainSettings(options = {}) {
  const s = { ...DEFAULT_CHAIN_SETTINGS, ...options };
  integer(s.developmentEnd, 2, 1000000, '발견 구간 끝');
  integer(s.endRound, s.developmentEnd + 1, 1000000, '평가 구간 끝');
  integer(s.maxLength, 2, 1000000, '연쇄 길이');
  integer(s.gap, 1, 10, '회차 간격');
  integer(s.minSupport, 2, 1000000, '최소 발생 수');
  integer(s.topK, 1, 30, '검증 후보 수');
  integer(s.maxNodes, 45, 500000, '탐색 예산');
  integer(s.seed, 0, 0xffffffff, '시드');
  if (!['fixed', 'walk-forward'].includes(s.mode)) throw Error('알 수 없는 평가 방식입니다.');
  return s;
}

export function cleanChainRows(input) {
  if (!Array.isArray(input)) throw Error('회차 데이터 배열이 필요합니다.');
  const seen = new Set();
  const rows = input.map(row => {
    integer(row.round, 1, 1000000, '회차');
    if (seen.has(row.round)) throw Error(`${row.round}회 중복: 분석을 중단했습니다.`);
    seen.add(row.round);
    if (!Array.isArray(row.numbers) || row.numbers.length !== 6 || new Set(row.numbers).size !== 6 ||
        row.numbers.some(n => !Number.isInteger(n) || n < 1 || n > 45)) throw Error(`${row.round}회 본번호 검증 실패`);
    return { round: row.round, numbers: [...row.numbers].sort((a, b) => a - b) };
  }).sort((a, b) => a.round - b.round);
  if (!rows.length) throw Error('분석할 확정 회차가 없습니다.');
  return rows;
}
export function numberMask(numbers) {
  let low = 0, high = 0;
  for (const number of numbers) {
    if (number <= 31) low |= 1 << (number - 1); else high |= 1 << (number - 32);
  }
  return { low, high };
}
export const rowIndex = rows => new Map(rows.map(row => [row.round, { ...row, ...numberMask(row.numbers) }]));
const contains = (row, mask) => row && (row.low & mask.low) === mask.low && (row.high & mask.high) === mask.high;

export function compileChain(stages, gaps) {
  if (!Array.isArray(stages) || stages.length < 2 || stages.length > 100000) throw Error('연쇄에는 2개 이상의 단계가 필요합니다.');
  if (!Array.isArray(gaps) || gaps.length !== stages.length - 1) throw Error('단계 사이의 간격 수를 확인해 주세요.');
  const offsets = [0];
  gaps.forEach(gap => offsets.push(offsets.at(-1) + integer(gap, 1, 10, '단계 간격')));
  const normalized = stages.map(stage => {
    if (!Array.isArray(stage) || stage.length < 1 || stage.length > 6 || new Set(stage).size !== stage.length ||
        stage.some(n => !Number.isInteger(n) || n < 1 || n > 45)) throw Error('각 단계에는 중복 없는 1~45 본번호 1~6개가 필요합니다.');
    return [...stage].sort((a, b) => a - b);
  });
  return { id: normalized.map((stage, i) => `${stage.join('+')}${i < gaps.length ? `~${gaps[i]}~` : ''}`).join(''),
    stages: normalized, gaps: [...gaps], offsets, span: offsets.at(-1), masks: normalized.map(numberMask),
    jointProbability: normalized.reduce((p, stage) => p * inclusionProbability(stage.length), 1),
    nullProbability: inclusionProbability(normalized.at(-1).length) };
}

export function parseChain(text, defaultGap = 1, gapText = '') {
  const stages = text.split('/').map(stage => stage.trim().split(/[,+\s]+/).filter(Boolean).map(Number));
  const gaps = gapText.trim() ? gapText.trim().split(/[,\s]+/).map(Number) : Array(stages.length - 1).fill(defaultGap);
  return compileChain(stages, gaps);
}

export function antecedentMatches(index, chain, target) {
  const start = target - chain.span;
  for (let i = 0; i < chain.masks.length - 1; i++) {
    if (!contains(index.get(start + chain.offsets[i]), chain.masks[i])) return false;
  }
  return true;
}

export function observeChain(index, chain, from, to, details = true) {
  let trials = 0, successes = 0, windows = 0;
  const occurrences = [], triggers = [], nextCounts = Array(45).fill(0), nextRounds = [];
  for (const [target, outcome] of index) {
    if (target < from || target > to) continue;
    const start = target - chain.span;
    if (!chain.offsets.every(offset => index.has(start + offset))) continue;
    windows++;
    if (!antecedentMatches(index, chain, target)) continue;
    trials++;
    const success = contains(outcome, chain.masks.at(-1));
    if (success) successes++;
    if (!details) continue;
    triggers.push({ start, target, success, numbers: outcome.numbers });
    if (success) {
      occurrences.push({ start, end: target, rounds: chain.offsets.map(offset => start + offset) });
      const following = index.get(target + chain.gaps.at(-1));
      if (following && following.round <= to) {
        nextRounds.push(following.round);
        for (const n of following.numbers) nextCounts[n - 1]++;
      }
    }
  }
  const probability = trials ? successes / trials : null;
  const logE = bernoulliLogE(successes, trials, chain.nullProbability);
  return { trials, successes, windows, probability, expected: windows * chain.jointProbability,
    conditionalExpected: trials * chain.nullProbability, effect: probability === null ? null : probability - chain.nullProbability,
    interval: conditionalInterval(successes, trials), logE, pValue: eToP(logE), occurrences, triggers,
    next: { gap: chain.gaps.at(-1), trials: nextRounds.length, counts: nextCounts, rounds: nextRounds } };
}

export function transitionMatrix(rows, lag, from, to) {
  integer(lag, 1, 10, '전이 간격');
  const index = new Map(rows.map(row => [row.round, row]));
  const counts = Array(45 * 45).fill(0), trials = Array(45).fill(0);
  let windows = 0;
  for (const target of rows) {
    if (target.round < from || target.round > to) continue;
    const source = index.get(target.round - lag);
    if (!source) continue;
    windows++;
    for (const a of source.numbers) {
      trials[a - 1]++;
      for (const b of target.numbers) counts[(a - 1) * 45 + b - 1]++;
    }
  }
  return { lag, from, to, windows, counts, trials, expectedJoint: windows * SINGLE_PROBABILITY ** 2 };
}

// Only observed extensions of frequent prefixes are visited. No Cartesian
// product of 45^length candidates is created, including for lengths > 10.
export function discoverChains(rows, options = {}, progress = () => {}) {
  const settings = chainSettings(options);
  const training = rows.filter(row => row.round <= settings.developmentEnd);
  if (!training.length) throw Error('발견 구간 데이터가 없습니다.');
  const index = new Map(training.map(row => [row.round, row]));
  const effectiveLength = Math.min(settings.maxLength, Math.floor((training.at(-1).round - training[0].round) / settings.gap) + 1);
  const roots = Array.from({ length: 45 }, (_, i) => ({ numbers: [i + 1], starts: [] }));
  training.forEach(row => row.numbers.forEach(n => roots[n - 1].starts.push(row.round)));
  let frontier = roots.filter(root => root.starts.length >= settings.minSupport);
  let visited = 45, pruned = 0, deepest = 1, stopped = '', top = [];
  outer: for (let length = 2; length <= effectiveLength; length++) {
    const next = [];
    for (const prefix of frontier) {
      const buckets = new Map();
      let trials = 0;
      for (const start of prefix.starts) {
        const row = index.get(start + (length - 1) * settings.gap);
        if (!row) continue;
        trials++;
        for (const n of row.numbers) {
          if (!buckets.has(n)) buckets.set(n, []);
          buckets.get(n).push(start);
        }
      }
      for (const [n, starts] of [...buckets].sort((a, b) => a[0] - b[0])) {
        if (++visited > settings.maxNodes) { stopped = '탐색 예산에 도달해 일부 관측 후보만 검사했습니다. 후보 누락 가능성이 있습니다.'; break outer; }
        if (starts.length < settings.minSupport) { pruned++; continue; }
        const numbers = [...prefix.numbers, n];
        next.push({ numbers, starts });
        const score = (starts.length - trials * SINGLE_PROBABILITY) / Math.sqrt(trials * SINGLE_PROBABILITY * (1 - SINGLE_PROBABILITY));
        if (score <= 0) continue;
        const chain = compileChain(numbers.map(value => [value]), Array(length - 1).fill(settings.gap));
        top.push({ chain, score, trainingTrials: trials, trainingSuccesses: starts.length });
        top.sort((a, b) => b.score - a.score || a.chain.id.localeCompare(b.chain.id, 'en'));
        if (top.length > settings.topK) top.pop();
      }
      progress(Math.min(visited, settings.maxNodes), settings.maxNodes);
    }
    deepest = length;
    frontier = next;
    if (!frontier.length) { stopped = `${length}단계에서 최소 ${settings.minSupport}회 발생 조건을 만족하는 연쇄가 없어 더 긴 탐색을 중단했습니다.`; break; }
  }
  if (!stopped) stopped = effectiveLength < settings.maxLength ? '요청한 연쇄의 시간 범위가 발견 구간보다 길어 분석 가능한 길이로 제한했습니다.' : '설정한 최대 길이까지 탐색했습니다.';
  return { candidates: top, visited: Math.min(visited, settings.maxNodes), pruned, deepest, effectiveLength,
    requestedLength: settings.maxLength, reason: stopped, partial: visited > settings.maxNodes,
    training: { from: training[0].round, to: training.at(-1).round, draws: training.length } };
}

export function analyzeChains(input, options = {}, progress = () => {}) {
  const started = performance.now(), settings = chainSettings(options);
  const rows = cleanChainRows(input).filter(row => row.round <= settings.endRound);
  const index = rowIndex(rows);
  const discovery = discoverChains(rows, settings, (done, total) => progress(done / total * .6));
  const patterns = discovery.candidates.map(({ chain, score }) => ({ chain, score,
    discovery: observeChain(index, chain, 1, settings.developmentEnd),
    evaluation: observeChain(index, chain, settings.developmentEnd + 1, settings.endRound) }));
  const adjusted = holm(patterns.map(pattern => pattern.evaluation.pValue));
  patterns.forEach((pattern, i) => {
    pattern.evaluation.adjustedP = adjusted[i];
    pattern.verdict = pattern.evaluation.trials < 20 ? '표본 부족' : '몬테카를로 검증 대기';
  });
  progress(.65);
  const forecast = evaluateChainForecast(rows, patterns, settings, fraction => progress(.65 + fraction * .35));
  return { version: CHAIN_VERSION, settings, discovery, patterns, forecast,
    data: { from: rows[0].round, to: rows.at(-1).round, draws: rows.length,
      missing: rows.at(-1).round - rows[0].round + 1 - rows.length,
      pending: Math.max(0, settings.endRound - rows.at(-1).round) },
    durationMs: performance.now() - started };
}

export function chainDetail(input, stages, gaps, options = {}) {
  const settings = chainSettings(options), chain = compileChain(stages, gaps);
  const rows = cleanChainRows(input).filter(row => row.round <= settings.endRound), index = rowIndex(rows);
  return { chain, discovery: observeChain(index, chain, 1, settings.developmentEnd),
    evaluation: observeChain(index, chain, settings.developmentEnd + 1, settings.endRound),
    periods: Array.from({ length: 4 }, (_, i) => {
      const from = Math.floor(settings.developmentEnd * i / 4) + 1, to = Math.floor(settings.developmentEnd * (i + 1) / 4);
      return { from, to, ...observeChain(index, chain, from, to, false) };
    }), exploratory: true };
}

export function experimentalTickets(index, target, patterns, seed, baseline) {
  const weights = Array(46).fill(1);
  let active = 0;
  for (const pattern of patterns) {
    if (pattern.chain.stages.at(-1).length !== 1 || !antecedentMatches(index, pattern.chain, target)) continue;
    const effect = Math.max(0, pattern.discovery.effect || 0);
    weights[pattern.chain.stages.at(-1)[0]] += effect;
    active++;
  }
  if (!active) return { tickets: baseline.map(line => [...line]), active };
  const random = randomFor(target, 10, seed);
  const tickets = Array.from({ length: 4 }, () => {
    const pool = Array.from({ length: 45 }, (_, i) => i + 1), line = [];
    while (line.length < 6) {
      const total = pool.reduce((sum, n) => sum + weights[n], 0);
      let cursor = random() * total, pick = 0;
      for (; pick < pool.length - 1; pick++) {
        cursor -= weights[pool[pick]];
        if (cursor < 0) break;
      }
      line.push(pool.splice(pick, 1)[0]);
    }
    return line.sort((a, b) => a - b);
  });
  return { tickets: [...tickets, [...baseline[4]]], active };
}

export function evaluateChainForecast(rows, initialPatterns, settings, progress = () => {}) {
  const history = newHistory(), prior = new Map(), rounds = [], logWealth = FORECAST_TILTS.map(() => 0);
  let patterns = initialPatterns, lastFit = settings.developmentEnd, skipped = 0;
  const totals = { experimental: 0, baseline: 0, activeRounds: 0 };
  const frequency = { experimental: Array(7).fill(0), baseline: Array(7).fill(0) };
  for (const row of rows) {
    if (row.round > settings.developmentEnd) {
      if (history.lastRound !== row.round - 1 || history.contiguous < 50) { skipped++; }
      else {
        if (settings.mode === 'walk-forward' && row.round - 1 >= lastFit + 50) {
          // Refits consume only the already appended past; never target/future rows.
          lastFit = row.round - 1;
          patterns = discoverChains(history.rows, { ...settings, developmentEnd: lastFit,
            endRound: Math.max(settings.endRound, lastFit + 1) }).candidates.map(({ chain }) => ({ chain,
            discovery: observeChain(prior, chain, 1, lastFit, false) }));
        }
        const baseline = picksFor(history, row.round, 8, settings.seed);
        const { tickets, active } = experimentalTickets(prior, row.round, patterns, settings.seed, baseline);
        const actual = new Set(row.numbers);
        const count = (lines, label) => lines.reduce((sum, line) => {
          const hits = line.filter(n => actual.has(n)).length;
          frequency[label][hits]++;
          return sum + hits;
        }, 0);
        const experimentalHits = count(tickets, 'experimental'), baselineHits = count(baseline, 'baseline');
        const difference = (experimentalHits - baselineHits) / 5;
        const mgfs = pairedLogMgfs(tickets, baseline);
        FORECAST_TILTS.forEach((tilt, i) => { logWealth[i] += tilt * difference - mgfs[i]; });
        totals.experimental += experimentalHits;
        totals.baseline += baselineHits;
        if (active) totals.activeRounds++;
        rounds.push({ round: row.round, priorEnd: history.lastRound, fittedThrough: lastFit, active,
          experimentalHits, baselineHits, difference, tickets, baseline });
      }
      progress((row.round - settings.developmentEnd) / (settings.endRound - settings.developmentEnd));
    }
    addDraw(history, row);
    prior.set(row.round, { ...row, ...numberMask(row.numbers) });
  }
  const n = rounds.length, delta = n ? (totals.experimental - totals.baseline) / (n * 5) : null;
  const interval = n >= 20 ? bootstrapRoundMean(rounds.map(round => round.difference), seededRandom(settings.seed ^ 0x52)) : null;
  const pValue = n >= 20 ? eToP(logMeanExp(logWealth)) : null;
  return { mode: settings.mode, rounds, n, games: n * 5, skipped, activeRounds: totals.activeRounds,
    experimentalMean: n ? totals.experimental / (n * 5) : null, baselineMean: n ? totals.baseline / (n * 5) : null,
    theoreticalMean: .8, difference: delta, interval, intervalMethod: '회차 단위 순환 블록 부트스트랩(근사, 블록 10)',
    pValue, adjustedP: pValue === null ? null : Math.min(1, pValue * 2), frequency,
    verdict: n < 20 ? '표본 부족' : delta > 0 && pValue * 2 <= .05 ? '설정한 평가에서 개선 신호 · 미래 재검증 필요' : '무작위 기준 대비 예측력 개선 확인 없음' };
}
