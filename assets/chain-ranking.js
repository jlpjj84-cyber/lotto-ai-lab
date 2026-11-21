export const RANKING_METHOD = 'conditional-family-ranking-v1';
const NUMBERS = Array.from({ length: 45 }, (_, i) => i + 1);
const P0 = 6 / 45;
const familyOf = c => c.stages.length === 1 ? (c.stages[0].length === 1 ? 'transition' : 'same-draw-set') :
  c.stages.some(stage => stage.length > 1) ? 'mixed-set-chain' : 'temporal-chain';
const byScore = (a, b) => b.score - a.score || a.number - b.number;
const bySelection = (a, b) => b.selectionScore - a.selectionScore || a.priorUses - b.priorUses || b.score - a.score || a.number - b.number;

// Every applicable registered condition contributes, including negative effects.
// Family normalization prevents hundreds of similar chains overwhelming the
// transition or set family simply because more conditions were enumerated.
export function scoreAllNumbers(active, settings) {
  const groups = new Map();
  for (const entry of active) {
    if (entry.trials < settings.minSupport) continue;
    const family = familyOf(entry), reliability = entry.trials / (entry.trials + settings.shrinkage);
    if (!groups.has(family)) groups.set(family, { entries: [], weight: 0 });
    groups.get(family).entries.push({ entry, reliability });
    groups.get(family).weight += reliability;
  }
  const candidates = [], scores = NUMBERS.map(number => {
    const components = [], strongest = [];
    let total = 0, relationCount = 0;
    for (const [family, group] of groups) {
      let weighted = 0, representative = null;
      for (const { entry, reliability } of group.entries) {
        const effect = (entry.counts[number] - entry.trials * P0) / (entry.trials + settings.shrinkage);
        const coefficient = reliability / group.weight / groups.size;
        const contribution = effect * coefficient;
        weighted += reliability * effect; relationCount++;
        const p = { id: `${entry.key}>${number}`, number, family, entry, effect, coefficient, contribution, score: Math.abs(contribution) };
        if (!representative || p.score > representative.score || (p.score === representative.score && p.id < representative.id)) representative = p;
      }
      if (representative) strongest.push(representative);
      const contribution = weighted / group.weight / groups.size;
      total += contribution;
      components.push({ family, conditions: group.entries.length, reliabilitySum: group.weight, weightedEffectSum: weighted, contribution });
    }
    candidates.push(...strongest);
    return { number, score: total * 100, rank: 0, relationCount, components,
      contributorIds: strongest.map(p => p.id),
      remainingContribution: total - strongest.reduce((sum, p) => sum + p.contribution, 0),
      evidenceStatus: relationCount ? '과거 조건 집계 · 예측 우위 미확인' : '조건 표본 부족 · 점수 0/동점 규칙' };
  });
  [...scores].sort(byScore).forEach((row, i) => { row.rank = i + 1; });
  return { scores, candidates, scoringMethod: RANKING_METHOD, fallback: groups.size === 0 };
}

export function emptyRankingModel(target, reason) {
  const result = scoreAllNumbers([], { minSupport: 8, shrinkage: 20 });
  return { target, ...result, candidates: [], fallbackReason: reason, diversityStrength: .35 };
}

function nextCombination(indices, n) {
  let i = indices.length - 1;
  while (i >= 0 && indices[i] === n - indices.length + i) i--;
  if (i < 0) return false;
  indices[i]++;
  for (let j = i + 1; j < indices.length; j++) indices[j] = indices[j - 1] + 1;
  return true;
}

// This function has no RNG dependency. All 30 default positions are selected by
// score -> explicit prior-game penalty -> prior use count -> number order.
export function generateRankedGames(model, { games = 5, uniqueLines = false, spread = false } = {}) {
  if (!Number.isInteger(games) || games < 1 || games > 20 || typeof uniqueLines !== 'boolean' || typeof spread !== 'boolean') throw Error('점수 추천의 게임 수·옵션을 확인해 주세요.');
  if (spread && games > 7) throw Error('번호를 모두 분산하면 최대 7게임입니다.');
  if (model.scoringMethod !== RANKING_METHOD || model.scores?.length !== 45 ||
    model.scores.some((row, i) => row.number !== i + 1 || !Number.isFinite(row.score) || !Number.isInteger(row.rank))) throw Error('45개 번호의 분석 점수가 필요합니다. 무작위로 채우지 않습니다.');
  const lines = [], trace = [], seen = new Set(), uses = Array(46).fill(0);
  const range = Math.max(...model.scores.map(r => r.score)) - Math.min(...model.scores.map(r => r.score));
  const strength = model.diversityStrength ?? .35;
  if (!Number.isFinite(strength) || strength < 0 || strength > 2) throw Error('분산 감점 설정 오류');
  const diversityScale = range * strength;
  for (let game = 0; game < games; game++) {
    const preGameScores = model.scores.map(row => ({ number: row.number, score: row.score, rank: row.rank,
      priorUses: uses[row.number], diversityPenalty: diversityScale * uses[row.number],
      selectionScore: row.score - diversityScale * uses[row.number], eligible: !spread || !uses[row.number] }));
    const ordered = preGameScores.filter(r => r.eligible).sort(bySelection), indices = [0, 1, 2, 3, 4, 5];
    if (ordered.length < 6) throw Error('선정 가능한 점수 후보가 6개 미만입니다.');
    let uniquenessSkips = 0;
    const lineAt = () => indices.map(i => ordered[i].number).sort((a, b) => a - b);
    while (uniqueLines && seen.has(lineAt().join(','))) {
      if (!nextCombination(indices, ordered.length)) throw Error('중복 조합 제한을 만족할 수 없습니다.');
      uniquenessSkips++;
    }
    const chosen = indices.map(i => ordered[i]), remaining = ordered.map(r => r.number);
    const decisions = chosen.map((row, i) => {
      const scored = model.scores[row.number - 1], pool = [...remaining];
      remaining.splice(remaining.indexOf(row.number), 1);
      return { step: i + 1, ...row, pool: pool.length, remainingCandidates: pool,
        selectionRank: ordered.indexOf(row) + 1, influences: [...scored.contributorIds], evidenceStatus: scored.evidenceStatus };
    });
    const line = lineAt(); lines.push(line); seen.add(line.join(','));
    trace.push({ method: 'ranked', role: 'experimental-score', shared: false, game: game + 1,
      diversityScale, uniquenessSkips, preGameScores, decisions,
      tieRule: '선정 점수 내림차순 → 이전 게임 사용 횟수 오름차순 → 분석 점수 내림차순 → 번호 오름차순' });
    for (const n of line) uses[n]++;
  }
  return { lines, trace, mode: 'evidence', selectionMethod: RANKING_METHOD };
}
