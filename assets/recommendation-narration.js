import { STRATEGIES } from './lotto-strategies.js';
import { drawFeatures } from './research-patterns.js';

export const MISSING_SELECTION = '생성 당시 확인 가능한 선정 근거 없음';

const names = new Map(STRATEGIES);
const methods = {
  'all-hot': 'hot', 'hot-30': 'hot', 'hot-50': 'hot', 'cold-50': 'cold',
  overdue: 'overdue', pairs: 'pairs', pattern: 'pattern', spread: 'uniform', random: 'uniform',
};
const windows = {
  'all-hot': '전체 이력', 'hot-30': '최근 30회', 'hot-50': '최근 50회', 'cold-50': '최근 50회',
};
const positions = ['첫 번째', '두 번째', '세 번째', '네 번째', '다섯 번째', '여섯 번째'];
const ranges = ['1~10', '11~20', '21~30', '31~40', '41~45'];
const count = value => Number.isInteger(value) && value >= 0;
const ranked = value => count(value) && value > 0;
const format = value => Number.isFinite(value) ? value.toFixed(3) : '—';
const poolSize = value => Number.isInteger(value) && value >= 6 && value <= 45;
const validTicket = line => Array.isArray(line) && line.length === 6 &&
  line.every((number, index) => ranked(number) && number <= 45 && (!index || number > line[index - 1]));

function candidatePool(size) {
  return size < 45 ? `앞선 게임에 쓴 번호 ${45 - size}개를 제외한 ${size}개 후보` : '45개 후보';
}

function describeSelection(selection, features) {
  const { method, decisions, pool } = selection;
  const [first, second, third] = decisions;
  const last = decisions.at(-1);
  const candidates = candidatePool(pool);
  switch (method) {
    case 'hot':
    case 'cold': {
      if (!decisions.every((d, index) => count(d.count) && ranked(d.weight) && d.pool === pool - index &&
          Number.isFinite(d.total) && d.total >= d.weight)) return null;
      const main = decisions.reduce((best, d) => d.weight > best.weight ? d : best);
      const position = decisions.indexOf(main);
      const weight = position
        ? `${positions[position]}로 뽑힌 ${main.number}번은 ${main.count}회 출현했고, 추출 가중치는 ${main.weight}로 이 게임에서 뽑힌 번호 중 가장 높았습니다.`
        : `${first.number}번의 출현 기록은 ${first.count}회였고, 추출에 적용한 가중치는 ${first.weight}입니다.`;
      return [`${candidates}에서 처음 뽑힌 번호는 ${first.number}번입니다.`, weight];
    }
    case 'overdue': {
      if (!ranked(first.rank) || last.rank > pool ||
          !decisions.every((d, index) => count(d.age) && d.rank === first.rank + index)) return null;
      // A default batch ranks the starting pool once and allocates consecutive groups of six.
      const remaining = pool - first.rank + 1;
      return [
        `${candidatePool(remaining)}에서 기록된 순위 ${first.rank}~${last.rank}의 번호를 배정했습니다.`,
        `${first.number}번은 ${first.age}회${first.censored ? ' 이상' : ' 동안'} 나오지 않아 당시 후보 ${first.rank}위였습니다.`,
      ];
    }
    case 'pairs':
      if (first.partner !== second.number || second.partner !== first.number || !count(first.count) ||
          first.count !== second.count || !decisions.slice(2).every(d => count(d.score) && Array.isArray(d.comparedWith))) return null;
      return [
        `${candidates}에서 ${first.count}회 함께 나온 ${first.number}번과 ${second.number}번을 먼저 골랐습니다.`,
        `다음에 고른 ${third.number}번의 두 번호에 대한 동시 출현 점수는 합계 ${third.score}였습니다.`,
      ];
    case 'pattern': {
      const { filter, attempt } = selection;
      if (!filter || !ranked(attempt) || ![filter.odds, filter.sumMin, filter.sumMax, filter.adjacent].every(count)) return null;
      const adjacent = features.runs.reduce((pairs, run) => pairs + run.length - 1, 0);
      if (features.odd !== filter.odds || features.sum < filter.sumMin || features.sum > filter.sumMax || adjacent < filter.adjacent) return null;
      return [
        `${candidates}로 만든 ${attempt}번째 후보 조합이 홀짝 ${features.odd}대${6 - features.odd}, 합계 ${features.sum}, 연속번호 ${adjacent}쌍으로 필터를 통과했습니다.`,
      ];
    }
    case 'uniform':
      if (!decisions.every((d, index) => d.pool === pool - index)) return null;
      return [`${candidates}에서 처음 ${first.number}번을 뽑았고, 마지막 추출에서는 남은 ${last.pool}개 중 ${last.number}번을 뽑았습니다.`];
    default:
      return null;
  }
}

function describeFeatures(features, others, method) {
  const { sum, odd, bands, runs, longest } = features;
  const peak = Math.max(...bands);
  const range = bands.indexOf(peak);
  if (method === 'pattern') {
    return peak >= 3 && bands.lastIndexOf(peak) === range
      ? `선정 후 번호 구간을 보면 ${ranges[range]}번 구간에 ${peak}개가 모였습니다.`
      : `선정 후 번호 구간을 보면 ${ranges.length}개 구간 중 ${bands.filter(Boolean).length}개에 걸쳐 있습니다.`;
  }
  if (runs.length) {
    const numbers = runs.map(run => run.join('·')).join(', ');
    const distinct = others.length && others.every(other => other.longest < longest)
      ? `이 묶음의 가장 긴 연속 구간은 번호 ${longest}개가 이어집니다` : `합계는 ${sum}입니다`;
    return `선정 후 확인된 연속번호는 ${numbers}번이고, ${distinct}.`;
  }
  const extreme = others.length && (others.every(other => sum < other.sum) ? '낮은'
    : others.every(other => sum > other.sum) ? '높은' : '');
  if (extreme) return `선정 후 합계는 이 묶음에서 가장 ${extreme} ${sum}이고, 홀짝은 ${odd}대${6 - odd}입니다.`;
  if (peak >= 3 && bands.lastIndexOf(peak) === range) {
    return `선정 후 ${ranges[range]}번 구간에 번호 ${peak}개가 모였고, 홀짝은 ${odd}대${6 - odd}입니다.`;
  }
  return `선정 후 합계는 ${sum}, 홀짝은 ${odd}대${6 - odd}입니다.`;
}

function describePrinciple(strategy, selection) {
  const label = `‘${names.get(strategy)}’ 전략`;
  switch (selection.method) {
    case 'hot':
    case 'cold':
      return `${label}은 ${windows[strategy]}의 출현 횟수가 ${selection.method === 'hot' ? '많을수록' : '적을수록'} 높은 가중치를 주고 추출합니다.`;
    case 'overdue':
      return `${label}은 연속해서 확인된 이력에서 오래 나오지 않은 번호에 앞 순위를 줍니다.`;
    case 'pairs':
      return `${label}은 가장 자주 함께 나온 후보 두 개로 시작해, 이미 고른 번호와의 동시 출현 합계가 큰 후보를 차례로 더합니다.`;
    case 'pattern': {
      const { odds, sumMin, sumMax, adjacent } = selection.filter;
      return `${label}은 균등하게 뽑은 후보 조합에서 홀수 ${odds}개, 합계 ${sumMin}~${sumMax}, 연속번호 ${adjacent}쌍 이상을 충족하는 조합을 고릅니다.`;
    }
    default:
      return `${label}은 각 추출에서 아직 뽑지 않은 후보에 같은 확률을 적용합니다.`;
  }
}

function describeValidation(validation, strategy, comparable) {
  const b = validation?.backtest;
  const m = validation?.monteCarlo;
  const studies = [
    ranked(b?.rounds) && ranked(b.games) && ['워크포워드', b,
      `${b.rounds}회 / ${b.games}게임 · 평균 ${format(b.mean)}개 · 같은 기간 무작위 대비 ${format(b.pairedDelta)}개`, '무작위 추첨의 이론값'],
    ranked(m?.played) && ranked(m.repetitions) && count(m.seed) && ['몬테카를로', m,
      `${m.played}회차 · ${m.mode === 'adaptive' ? '순차 갱신' : '조합 고정'} · ${m.repetitions}회 반복 · 시드 ${m.seed}`, '같은 회차의 균등 무작위 전략'],
  ].filter(Boolean);
  if (!studies.length) return ['이 추천에 연결된 검증 결과는 없습니다.'];
  return studies.map(([name, result, detail, baseline]) => {
    const { adjusted, settings, first, last } = result;
    const different = comparable === false || settings?.window || settings?.trainStart !== 1;
    const period = ranked(first) && ranked(last) && first <= last ? ` ${first}~${last}회` : '';
    const window = settings?.window ? `이동 학습창 ${settings.window}회` : '확장 학습창';
    const validP = Number.isFinite(adjusted) && adjusted >= 0 && adjusted <= 1;
    const p = validP ? ` · 보정 p ${adjusted > 0 && adjusted < .001 ? adjusted.toExponential(2) : format(adjusted)}` : '';
    const status = strategy === 'random' ? '무작위 비교 기준'
      : !validP ? '유의성 판단 자료 부족'
        : adjusted <= .05 ? `${baseline} 대비 통계적으로 유의한 과거 차이` : `${baseline} 대비 과거 적중 우위의 통계적 증거 없음`;
    return `생성 시점 ${name}${period} · ${window} · ${detail}${p} · ${status}${different ? ' · 생성 조건이 달라 참고용' : ''}`;
  });
}

function describeCommon(selections, { strategy, options, comparable, research }) {
  const method = methods[strategy];
  const main = selections.find(item => typeof item.shared !== 'boolean');
  const common = [main ? describePrinciple(strategy, main) : `적용 전략 ${names.get(strategy)}`];
  if (options.spread || selections.some(item => item.disjoint)) {
    common.push(options.spread ? '앞선 게임의 번호를 이후 게임 후보에서 제외합니다.'
      : '같은 묶음 안의 전략 게임끼리는 앞서 쓴 번호를 다시 사용하지 않습니다.');
  }
  if (options.uniqueLines) common.push('이미 나온 동일한 6개 조합은 제외합니다.');
  else if (method === 'pattern' && main?.filter?.unique && !options.spread) common.push('같은 묶음의 패턴 게임에서 동일한 조합은 한 번만 선택합니다.');
  if (selections.some(item => item.shared)) {
    common.push('공통 무작위 게임은 앞선 게임의 번호도 후보에 넣으며, 같은 시드와 생성 묶음의 다른 전략과 조합을 공유합니다.');
  }
  return [...common, '상세 표의 참고 통계 열에는 최근·이전 출현률 비교와 미출현 기간을 따로 표시합니다.',
    ...describeValidation(research.validation, strategy, comparable),
    '검증 범위는 과거의 회차당 5게임 적중 성적입니다. 공정한 추첨에서 각 6개 조합의 1등 확률은 1/8,145,060입니다.'];
}

export function describeRecommendation({ lines, research, strategy, options = {}, comparable }) {
  if (!names.has(strategy) || !Array.isArray(research?.lines)) return { common: [], games: [] };
  const features = lines.map(line => validTicket(line) ? drawFeatures(line) : null);
  const selections = [];
  const games = lines.map((line, index) => {
    const selection = research.lines[index]?.selection;
    const decisions = selection?.decisions;
    if (!features[index] || !poolSize(selection?.pool) || !Array.isArray(decisions) || decisions.length !== 6 ||
        !line.every(number => decisions.filter(d => d?.number === number).length === 1)) return null;
    if (selection.pool < 45 && !selection.disjoint && !options.spread) return null;
    const extra = selection.method === 'uniform' && typeof selection.shared === 'boolean';
    if (extra && (selection.shared ? selection.pool !== 45 || options.spread : !options.spread)) return null;
    if (!extra && methods[strategy] !== selection.method) return null;
    const evidence = describeSelection(selection, features[index]);
    if (!evidence) return null;
    selections.push(selection);
    const role = selection.shared === true ? ' · 공통 무작위' : selection.shared === false ? ' · 분산 무작위' : '';
    return {
      title: `${index + 1}게임 — 개별 추천 해설${role}`,
      selection: evidence.join(' '),
      observed: describeFeatures(features[index], features.filter((item, other) => item && other !== index), selection.method),
    };
  });
  return { common: selections.length ? describeCommon(selections, { strategy, options, comparable, research }) : [], games };
}
