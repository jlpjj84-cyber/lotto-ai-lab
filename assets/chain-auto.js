import { addDraw, newHistory, picksFor } from './lotto-strategies.js';
import { cleanChainRows, numberMask } from './chain-research.js';
import { bootstrapRoundMean } from './research-backtest.js';
import { seededRandom } from './research-math.js';
import { bernoulliLogE, conditionalInterval, eToP, FORECAST_TILTS, logMeanExp, pairedLogMgfs } from './chain-math.js';
import { scheduleFor } from './lotto-calendar.js';
import { scoreAllNumbers, emptyRankingModel, generateRankedGames } from './chain-ranking.js';
import { generateControlGames } from './chain-control.js';

export const AUTO_CHAIN_ID = 'chain-experiment';
export const AUTO_CHAIN_NAME = '연쇄 패턴 기반 실험 추천';
export const AUTO_CHAIN_VERSION = '5.2.2';
export const AUTO_CHAIN_DEFAULTS = Object.freeze({ seed: 645, maxLag: 10, maxLength: 10,
  minSupport: 8, beam: 12, maxModels: 50000, maxPending: 60000,
  maxLongQueries: 512, evaluationStart: 1001, shrinkage: 20, diversityStrength: .35 });

export function autoChainSettings(options = {}) {
  const s = { ...AUTO_CHAIN_DEFAULTS, ...options };
  for (const [key, min, max] of [['seed', 0, 0xffffffff], ['maxLag', 1, 10], ['maxLength', 2, 100],
    ['minSupport', 2, 1000], ['beam', 1, 30],
    ['maxModels', 1, 100000], ['maxPending', 1, 200000], ['maxLongQueries', 1, 3000],
    ['evaluationStart', 51, 9999], ['shrinkage', 1, 1000]]) {
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max) throw Error(`자동 연쇄 설정 오류: ${key}`);
  }
  if (!Number.isFinite(s.diversityStrength) || s.diversityStrength < 0 || s.diversityStrength > 2) throw Error('분산 감점 설정 오류');
  return s;
}
const p0 = 6 / 45;
const matches = (row, mask) => row && (row.low & mask.low) === mask.low && (row.high & mask.high) === mask.high;
export const contextName = c => c.stages.map((stage, i) => `${c.lags[i]}회 전 ${stage.join('+')}`).join(' & ');
export const autoHistorySignature = input => cleanChainRows(input).map(row => `${row.round}:${row.numbers.join(',')}`).join('|');

function feature(lags, stages) {
  return { key: lags.map((lag, i) => `${lag}:${stages[i].join('+')}`).join('|'), lags, stages, masks: stages.map(numberMask) };
}
function contextMatches(index, c, target) {
  return c.lags.every((lag, i) => matches(index.get(target - lag), c.masks[i]));
}

// Conditional tables are updated only AFTER predicting the current draw.
// Base conditions enumerate observed numbers, not all 45^L combinations.
export class AutomaticChainState {
  constructor(options = {}) {
    this.settings = autoChainSettings(options);
    this.index = new Map(); this.positions = Array.from({ length: 46 }, () => []);
    this.models = new Map(); this.pending = new Map(); this.longModels = new Set(); this.registered = 0;
    this.limits = { pending: 0, models: 0, longQueries: 0, deepest: 1 };
  }
  register(c, targets, target) {
    if (this.models.size >= this.settings.maxModels) { this.limits.models++; return null; }
    const entry = { ...c, trials: targets.length, counts: new Uint32Array(46), targets: [...targets],
      validationTrials: 0, validationCounts: new Uint32Array(46), registeredAt: target, serial: ++this.registered };
    for (const t of targets) for (const n of this.index.get(t).numbers) entry.counts[n]++;
    this.models.set(c.key, entry); this.pending.delete(c.key);
    if (c.stages.length >= 3 || (c.stages.length === 2 && c.stages.some(stage => stage.length > 1))) this.longModels.add(entry);
    return entry;
  }
  priorTargets(c, target) {
    let anchor = [c.stages[0][0], c.lags[0]];
    for (let i = 0; i < c.stages.length; i++) for (const n of c.stages[i]) {
      if (this.positions[n].length < this.positions[anchor[0]].length) anchor = [n, c.lags[i]];
    }
    const targets = [];
    for (const round of this.positions[anchor[0]]) {
      const t = round + anchor[1];
      if (t >= target) break;
      if (this.index.has(t) && contextMatches(this.index, c, t)) targets.push(t);
    }
    return targets;
  }
  prepare(target) {
    const s = this.settings, contexts = new Map(), active = [];
    const consider = (c, long = false) => {
      if (contexts.has(c.key)) return contexts.get(c.key);
      let entry = this.models.get(c.key);
      if (!entry) {
        const pending = this.pending.get(c.key);
        if (pending?.targets.length >= s.minSupport) entry = this.register(c, pending.targets, target);
        else if (long) {
          const targets = this.priorTargets(c, target);
          if (targets.length >= s.minSupport) entry = this.register(c, targets, target);
        } else if (!pending) {
          if (this.pending.size < s.maxPending) this.pending.set(c.key, { ...c, targets: [] });
          else this.limits.pending++;
        }
      }
      contexts.set(c.key, entry || null);
      if (entry) { active.push(entry); this.limits.deepest = Math.max(this.limits.deepest, c.stages.length + 1); }
      return entry;
    };
    for (let lag = 1; lag <= s.maxLag; lag++) {
      const row = this.index.get(target - lag);
      if (!row) continue;
      for (const n of row.numbers) consider(feature([lag], [[n]]));
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) consider(feature([lag], [[row.numbers[i], row.numbers[j]]]));
    }
    if (s.maxLength >= 3) {
      const pairs = new Set();
      for (let gap = 1; gap <= s.maxLag; gap++) { pairs.add(`${2 * gap},${gap}`); pairs.add(`${gap + 1},1`); }
      for (const pair of pairs) {
        const lags = pair.split(',').map(Number), first = this.index.get(target - lags[0]), last = this.index.get(target - lags[1]);
        if (!first || !last) continue;
        for (const a of first.numbers) for (const b of last.numbers) consider(feature(lags, [[a], [b]]));
      }
    }
    // Longer temporal and mixed-set conditions extend frequent current contexts
    // through a bounded beam. Exact vertical intersections backfill past counts;
    // those backfilled outcomes are NEVER used as post-registration validation.
    let parents = active.filter(c => c.stages.length === 2 || c.stages.some(stage => stage.length > 1));
    let queries = 0;
    for (let length = 2; length < s.maxLength && parents.length; length++) {
      const next = [];
      parents.sort((a, b) => b.trials - a.trials || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      for (const parent of parents.slice(0, s.beam)) {
        const step = parent.lags.length > 1 ? parent.lags[0] - parent.lags[1] : parent.lags[0];
        if (step > s.maxLag) continue;
        const lag = parent.lags[0] + step, row = this.index.get(target - lag);
        if (!row) continue;
        for (const n of row.numbers) {
          if (++queries > s.maxLongQueries) { this.limits.longQueries++; break; }
          const c = feature([lag, ...parent.lags], [[n], ...parent.stages]);
          if (c.stages.length + 1 > s.maxLength) continue;
          const entry = consider(c, true);
          if (entry) next.push(entry);
        }
        if (queries > s.maxLongQueries) break;
      }
      parents = next;
      if (queries > s.maxLongQueries) break;
    }
    // Once a condition is admitted, count EVERY later occurrence, including
    // occurrences on days when that branch is outside the discovery beam.
    for (const entry of this.longModels) if (!contexts.has(entry.key) && contextMatches(this.index, entry, target)) {
      contexts.set(entry.key, entry); active.push(entry);
    }
    return { target, contexts, ...scoreAllNumbers(active, s), diversityStrength: s.diversityStrength };
  }
  append(row, prepared) {
    for (const [key, entry] of prepared.contexts) {
      if (entry) {
        entry.trials++; entry.targets.push(row.round); entry.validationTrials++;
        for (const n of row.numbers) { entry.counts[n]++; entry.validationCounts[n]++; }
      } else {
        const pending = this.pending.get(key);
        if (pending && pending.targets.length < this.settings.minSupport) pending.targets.push(row.round);
      }
    }
    this.index.set(row.round, { ...row, ...numberMask(row.numbers) });
    for (const n of row.numbers) this.positions[n].push(row.round);
  }
}

export function generateChainGames(model, options = {}) {
  return generateRankedGames(model, options);
}

function evidence(candidate, index, through) {
  const { entry, number } = candidate, n = entry.validationTrials, successes = entry.validationCounts[number];
  // Predictable alpha allocation on registration: sum_j 1/[j(j+1)] = 1;
  // each context allocates its weight equally to the 45 possible outcomes.
  const adjustedP = n ? Math.min(1, eToP(bernoulliLogE(successes, n)) * 45 * entry.serial * (entry.serial + 1)) : null;
  return { id: candidate.id, number, context: { key: entry.key, lags: entry.lags, stages: entry.stages },
    trials: entry.trials, successes: entry.counts[number], conditionalRate: entry.counts[number] / entry.trials,
    effect: entry.counts[number] / entry.trials - p0, contribution: candidate.contribution,
    family: candidate.family, scoreCoefficient: candidate.coefficient, shrunkEffect: candidate.effect,
    targets: [...entry.targets], successfulTargets: entry.targets.filter(t => index.get(t).numbers.includes(number)),
    through, validation: { registeredAt: entry.registeredAt, trials: n, successes, adjustedP,
      interval: conditionalInterval(successes, n), method: '등록 이후 순차 검정 · 등록 순서/45개 결과 전체 보정',
      status: n < 20 ? '표본 부족' : adjustedP <= .05 && successes / n > p0 ? '순차 재현 신호 · 미래 재검증 필요' : '통계적 우위 확인 없음' } };
}

export function automaticChainAnalysis(input, options = {}, progress = () => {}) {
  const started = performance.now(), settings = autoChainSettings(options), rows = cleanChainRows(input);
  const complete = rows[0].round === 1 && rows.every((row, i) => row.round === i + 1);
  const latest = rows.at(-1).round, history = newHistory(), state = new AutomaticChainState(settings);
  const rounds = [], logWealth = FORECAST_TILTS.map(() => 0), frequency = { experimental: Array(7).fill(0), baseline: Array(7).fill(0) };
  let experimentalHits = 0, baselineHits = 0, activeRounds = 0;
  if (complete) for (const [i, row] of rows.entries()) {
    const model = state.prepare(row.round);
    if (row.round >= settings.evaluationStart && history.contiguous >= 50) {
      const experimental = generateChainGames(model, { seed: settings.seed }).lines;
      const baseline = picksFor(history, row.round, 8, settings.seed);
      const hit = (lines, label) => lines.reduce((sum, line) => {
        const n = line.filter(number => row.numbers.includes(number)).length; frequency[label][n]++; return sum + n;
      }, 0);
      const a = hit(experimental, 'experimental'), b = hit(baseline, 'baseline'), difference = (a - b) / 5;
      const mgfs = pairedLogMgfs(experimental, baseline);
      FORECAST_TILTS.forEach((tilt, j) => { logWealth[j] += tilt * difference - mgfs[j]; });
      rounds.push({ round: row.round, through: row.round - 1, games: 5, experimental, baseline, experimentalHits: a,
        baselineHits: b, difference, weakEvidence: model.fallback, scoreVector: model.scores.map(row => row.score),
        rankVector: model.scores.map(row => row.rank), selectionMethod: model.scoringMethod });
      experimentalHits += a; baselineHits += b; if (!model.fallback) activeRounds++;
    }
    state.append(row, model); addDraw(history, row);
    if (i % 10 === 0) progress((i + 1) / rows.length * .95);
  }
  const model = complete ? state.prepare(latest + 1) : emptyRankingModel(latest + 1, '1회부터 최신 회차까지 자료가 불완전해 분석 점수 산출을 중단했습니다.');
  const candidates = model.candidates.map(p => evidence(p, state.index, latest));
  const forecast = complete ? generateChainGames(model) : { lines: [], trace: [], mode: 'evidence', unavailable: true };
  const control = generateControlGames(latest + 1, { seed: settings.seed });
  const n = rounds.length, games = n * 5, difference = n ? (experimentalHits - baselineHits) / games : null;
  const pValue = n >= 20 ? eToP(logMeanExp(logWealth)) : null;
  const validation = { mode: 'every-draw-walk-forward', from: rounds[0]?.round ?? null, to: rounds.at(-1)?.round ?? null,
    rounds, n, games, activeRounds, frequency, experimentalMean: n ? experimentalHits / games : null,
    baselineMean: n ? baselineHits / games : null, difference, pValue,
    interval: n >= 20 ? bootstrapRoundMean(rounds.map(r => r.difference), seededRandom(settings.seed ^ 0xa520)) : null,
    status: n < 20 ? '표본 부족' : difference > 0 && pValue <= .05 ? '과거 순차 평가의 개선 신호 · 미래 재검증 필요' : '무작위보다 높은 예측력 확인 없음' };
  progress(1);
  return { version: AUTO_CHAIN_VERSION, strategy: AUTO_CHAIN_ID, settings, data: { first: rows[0].round, latest,
    count: rows.length, complete, signature: autoHistorySignature(rows) }, model: { target: model.target, scores: model.scores,
      scoringMethod: model.scoringMethod, diversityStrength: model.diversityStrength, candidates, fallback: model.fallback,
      fallbackReason: !complete ? model.fallbackReason : model.fallback ? '조건 표본 부족: 점수 0과 명시적 동점/분산 규칙을 쓰는 미검증 실험 추천' : null },
    recommendation: { target: latest + 1, ...scheduleFor(latest + 1), ...forecast },
    control: { target: latest + 1, ...scheduleFor(latest + 1), ...control }, validation,
    search: { registered: state.models.size, pending: state.pending.size, limits: state.limits,
      policy: '전이 1~10회 · 동일 회차 번호쌍 · 동일/혼합 간격 연쇄 · 빈발 조건 빔 확장' }, durationMs: performance.now() - started };
}
