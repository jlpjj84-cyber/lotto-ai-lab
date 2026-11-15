import { STRATEGIES } from './lotto-strategies.js';

export const MISSING_SELECTION = '생성 당시 확인 가능한 선정 근거 없음';

const names = new Map(STRATEGIES);
const methods = {
  'all-hot': 'hot', 'hot-30': 'hot', 'hot-50': 'hot', 'cold-50': 'cold',
  overdue: 'overdue', pairs: 'pairs', pattern: 'pattern', spread: 'uniform', random: 'uniform',
};
const windows = {
  'all-hot': '전체 이력', 'hot-30': '최근 30회', 'hot-50': '최근 50회', 'cold-50': '최근 50회',
};
const count = value => Number.isInteger(value) && value >= 0;
const ranked = value => count(value) && value > 0;

function describeSelection(game, strategy) {
  const { selection, features } = game;
  const { method, decisions, pool, shared } = selection;
  const [first, second, third] = decisions;
  const label = `‘${names.get(strategy)}’`;

  switch (method) {
    case 'hot':
    case 'cold':
      if (!decisions.every((d, index) => count(d.count) && ranked(d.weight) && ranked(d.pool) &&
          d.pool === pool - index && Number.isFinite(d.total) && d.total >= d.weight)) return null;
      return [
        `${label} 전략은 ${windows[strategy]}에서 출현 횟수가 ${method === 'hot' ? '많을수록' : '적을수록'} 높은 가중치를 주고, 그 가중치에 따라 후보를 무작위로 뽑았습니다.`,
        `첫 번째로 뽑힌 ${first.number}번은 이 기간에 ${first.count}회 나왔으며, 이때 적용한 추출 가중치는 ${first.weight}입니다.`,
      ];
    case 'overdue':
      if (!decisions.every(d => count(d.age) && ranked(d.rank))) return null;
      return [
        `${label} 전략은 연속해서 확인된 이력에서 오래 나오지 않은 번호부터 순위를 매겨 골랐습니다.`,
        `${first.number}번은 ${first.age}회${first.censored ? ' 이상' : ' 동안'} 나오지 않아 후보 ${first.rank}위였고, 이번 게임에 포함됐습니다.`,
      ];
    case 'pairs':
      if (first.partner !== second.number || second.partner !== first.number || !count(first.count) ||
          first.count !== second.count || !decisions.slice(2).every(d => count(d.score) && Array.isArray(d.comparedWith))) return null;
      return [
        `${label} 전략은 남은 후보에서 과거에 가장 자주 함께 나온 두 번호로 시작해, 이미 고른 번호들과의 동시 출현 합계가 가장 큰 후보를 차례로 더했습니다.`,
        `${first.number}번과 ${second.number}번은 ${first.count}회 함께 나왔고, 다음에 고른 ${third.number}번의 두 번호에 대한 동시 출현 점수 합계는 ${third.score}였습니다.`,
      ];
    case 'pattern': {
      const filter = selection.filter;
      if (!filter || !ranked(selection.attempt) || ![filter.odds, filter.sumMin, filter.sumMax, filter.adjacent].every(count) ||
          !count(features?.odd) || !count(features?.sum) || !Array.isArray(features?.runs) ||
          !features.runs.every(run => Array.isArray(run) && run.length > 1)) return null;
      const adjacent = features.runs.reduce((pairs, run) => pairs + run.length - 1, 0);
      if (features.odd !== filter.odds || features.sum < filter.sumMin || features.sum > filter.sumMax || adjacent < filter.adjacent) return null;
      return [
        `${label} 전략은 후보를 균등하게 뽑은 뒤 홀수 ${filter.odds}개, 합계 ${filter.sumMin}~${filter.sumMax}, 연속번호 ${filter.adjacent}쌍 이상인 조합을 골랐습니다.`,
        `${selection.attempt}번째 후보 조합은 홀짝 ${features.odd}대${6 - features.odd}, 합계 ${features.sum}, 연속번호 ${adjacent}쌍으로 필터를 통과했습니다.`,
      ];
    }
    case 'uniform': {
      if (!Number.isInteger(pool) || pool < 6 || pool > 45 || !decisions.every((d, index) => d.pool === pool - index)) return null;
      const last = decisions.at(-1);
      const opening = shared === true ? `${label} 묶음의 공통 무작위 게임으로, 같은 시드와 묶음의 다른 전략에도 이 조합을 사용합니다.`
        : shared === false ? `${label}에 번호 분산 옵션을 적용해, 앞선 게임의 번호를 뺀 후보에서 별도의 무작위 게임을 만들었습니다.`
        : `${label} 전략으로 이미 뽑은 번호를 빼면서 다음 번호를 골랐습니다.`;
      return [opening, `추출할 때마다 남은 후보의 확률이 같았고, 처음에는 ${pool}개 중 ${first.number}번, 마지막에는 ${last.pool}개 중 ${last.number}번이 뽑혔습니다.`];
    }
    default:
      return null;
  }
}

function describeConstraints(selection, options) {
  const rules = [];
  if (options.spread) rules.push('전체 생성 결과에서 먼저 쓴 번호는 다음 게임 후보에서 제외');
  else if (selection.disjoint) rules.push('같은 묶음에서 먼저 쓴 번호는 다음 전략 게임 후보에서 제외');
  else if (selection.shared) rules.push('앞선 게임에서 나온 번호도 후보에 포함');
  if (options.uniqueLines) rules.push('이미 나온 6개 조합은 전체 생성 결과에서 제외');
  else if (selection.filter?.unique && !options.spread) rules.push('같은 묶음에서 이미 나온 패턴 조합은 제외');
  return rules.length ? `게임 안에서는 번호 6개를 중복 없이 뽑았으며, ${rules.join('하고 ')}했습니다.`
    : '게임 안에서는 같은 번호를 한 번만 뽑았습니다.';
}

function describeValidation(validation, strategy, comparable) {
  const studies = [
    ['워크포워드', validation?.backtest?.rounds > 0 && validation.backtest, '무작위 추첨의 이론적 기대'],
    ['몬테카를로', validation?.monteCarlo?.played > 0 && validation.monteCarlo, '같은 회차의 균등 무작위 전략'],
  ].filter(([, result]) => result);
  if (!studies.length) return ['이 추천에 연결된 검증 결과는 없습니다.'];
  return studies.map(([name, result, baseline]) => {
    const different = comparable === false || result.settings?.window || result.settings?.trainStart !== 1;
    const scope = different ? '다른 조건으로 매 회차 만든 5게임' : '같은 전략으로 매 회차 만든 5게임';
    if (strategy === 'random') return `저장된 ${name} 검증에서 ${scope}이 무작위 비교 기준으로 쓰였습니다.`;
    const { adjusted } = result;
    const finding = !Number.isFinite(adjusted) || adjusted < 0 || adjusted > 1
      ? '통계적 우위를 판정할 자료가 부족했습니다'
      : adjusted <= .05 ? `${baseline} 대비 적중 성과에서 통계적으로 유의한 차이가 관측됐습니다`
        : `${baseline}보다 높은 과거 적중 성과에 대한 통계적 증거는 확인되지 않았습니다`;
    return `저장된 ${name}에서 ${different ? '참고로 ' : ''}${scope}을 평가한 결과, ${finding}.`;
  });
}

export function recommendationNarration(line, game, { strategy, options = {}, validation, comparable } = {}) {
  const selection = game?.selection;
  const decisions = selection?.decisions;
  if (!names.has(strategy) || !Array.isArray(line) || line.length !== 6 || new Set(line).size !== 6 ||
      !Array.isArray(decisions) || decisions.length !== 6 ||
      !line.every(number => ranked(number) && number <= 45 && decisions.filter(d => d?.number === number).length === 1)) return null;
  const isExtraRandom = selection.method === 'uniform' && typeof selection.shared === 'boolean';
  if (!isExtraRandom && methods[strategy] !== selection.method) return null;
  const selectionSentences = describeSelection(game, strategy);
  if (!selectionSentences) return null;
  const reference = selection.method === 'uniform' || selection.method === 'pattern'
    ? '표의 출현률과 미출현 기간은 뽑힌 번호의 과거 모습을 보여 주는 참고 통계입니다.'
    : '표의 최근·이전 출현률 비교와 조합 통계는 참고용이며, 위 선정 과정에 쓰인 값은 실제 추출 기록에서 가져왔습니다.';
  return [
    ...selectionSentences,
    describeConstraints(selection, options),
    reference,
    ...describeValidation(validation, strategy, comparable),
  ].join(' ');
}
