import { drawFeatures, overlap } from './research-patterns.js';
import { EXPECTED_MATCHES } from './research-backtest.js';
import { STUDY_VERSION } from './research-study.js';

export function explainSelections(rows, targetRound, { lines, trace }) {
  const history = rows.filter(row => row.round < targetRound);
  const recent = history.slice(-50);
  const allCounts = new Uint16Array(46);
  const recentCounts = new Uint16Array(46);
  const last = new Uint16Array(46);
  for (const row of history) for (const n of row.numbers) {
    allCounts[n]++;
    last[n] = Math.max(last[n], row.round);
  }
  for (const row of recent) for (const n of row.numbers) recentCounts[n]++;
  const previous = history.at(-1);
  let consecutive = 0;
  for (let i = history.length - 1; i >= 0 && history[i].round === targetRound - 1 - consecutive; i--) consecutive++;
  return {
    version: STUDY_VERSION,
    recent: recent.length,
    earlier: history.length - recent.length,
    lines: lines.map((line, i) => {
      const { sum, odd, bands, runs } = drawFeatures(line);
      let maxOverlap = 0, matchingDraws = 0;
      for (const row of history) {
        const match = overlap(line, row.numbers);
        if (match > maxOverlap) { maxOverlap = match; matchingDraws = 0; }
        if (match === maxOverlap) matchingDraws++;
      }
      return {
        selection: trace?.[i] ?? null,
        features: { sum, odd, bands, runs, maxOverlap, matchingDraws },
        reference: line.map(number => ({
          number, recent: recentCounts[number], earlier: allCounts[number] - recentCounts[number],
          gap: previous ? Math.min(consecutive, previous.round - last[number]) : null,
          gapCensored: previous ? last[number] < targetRound - consecutive : true,
        })),
      };
    }),
  };
}

export function backtestEvidence(result, strategy) {
  const row = result?.strategies.find(item => item.id === strategy)?.evaluation;
  if (!row?.games) return null;
  const random = result.strategies.find(item => item.id === 'random').evaluation;
  return { modelVersion: STUDY_VERSION, settings: result.settings, first: result.evaluation[0],
    last: result.evaluation.at(-1), rounds: row.draws, games: row.games, mean: row.mean,
    theoreticalDelta: row.mean - EXPECTED_MATCHES, pairedDelta: row.mean - random.mean,
    adjusted: row.adjusted, interval: row.interval };
}

export function simulationEvidence(result, strategy) {
  const row = result?.strategies.find(item => item.id === strategy);
  if (!row) return null;
  return { modelVersion: result.modelVersion, mode: result.mode, settings: result.settings, seed: result.seed,
    repetitions: result.repetitions, played: result.played.length, first: result.played[0], last: result.played.at(-1),
    observedDelta: row.observedDelta, adjusted: row.adjusted, interval: row.paired.interval };
}

export function reasonFor(selection, number) {
  if (!Array.isArray(selection?.decisions)) return '확인 가능한 선정 근거 없음';
  const position = selection.decisions.findIndex(item => item.number === number);
  const chosen = selection.decisions[position];
  if (!chosen) return '확인 가능한 선정 근거 없음';
  switch (selection.method) {
    case 'hot':
    case 'cold': {
      const share = 100 * chosen.weight / chosen.total;
      const formula = selection.method === 'hot' ? '(출현 + 2)²' : '(60 − 출현)²';
      return `출현 ${chosen.count}회 · ${formula} = ${chosen.weight} · ${position + 1}번째 추출에서 후보 ${chosen.pool}개 중 가중 비중 ${share.toFixed(2)}%`;
    }
    case 'overdue':
      return `미출현 ${chosen.age}회${chosen.censored ? ' 이상' : ''} · 후보 순위 ${chosen.rank}위 · 동률은 시드로 결정`;
    case 'pairs':
      return chosen.partner ?
        `${chosen.partner}번과 동시 출현 ${chosen.count}회 · 당시 후보 중 최다 번호쌍` :
        `앞서 선택한 ${chosen.comparedWith.join('·')}번과의 동시 출현 합계 ${chosen.score} · 당시 후보 최고 점수`;
    case 'pattern':
      return `후보 ${chosen.pool}개 중 균등 추출 · ${selection.attempt}번째 후보 조합이 홀짝 3:3·합계 100~149·연속쌍을 충족`;
    case 'uniform':
      return `${selection.shared ? '공통 무작위 게임 · ' : ''}${position + 1}번째 추출에서 후보 ${chosen.pool}개 중 균등 선택`;
    default:
      return '확인 가능한 선정 근거 없음';
  }
}

export function referenceFor(evidence, row) {
  if (!row) return '';
  const sample = (k, n) => n ? `${k}/${n}회` : '자료 없음';
  const delta = evidence.recent && evidence.earlier ? (row.recent / evidence.recent - row.earlier / evidence.earlier) * 100 : null;
  return `최근 ${sample(row.recent, evidence.recent)} · 이전 ${sample(row.earlier, evidence.earlier)}` +
    (delta === null ? '' : ` · 등장률 차이 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%p`) +
    (row.gap === null ? '' : ` · 미출현 ${row.gap}회${row.gapCensored ? ' 이상' : ''}`);
}

export function featuresText(features) {
  return `홀짝 ${features.odd}:${6 - features.odd} · 합계 ${features.sum} · 구간 1~10/11~20/21~30/31~40/41~45: ${features.bands.join('/')}` +
    ` · 연속번호 ${features.runs.length ? features.runs.map(run => run.join('·')).join(', ') : '없음'}` +
    ` · 역대 최대 ${features.maxOverlap}개 일치(${features.matchingDraws}회)`;
}
