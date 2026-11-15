import { addDraw, newHistory, WARMUP } from './lotto-strategies.js';

export const DEVELOPMENT_END = 1000;
export const STUDY_VERSION = '5.0.0';

export function studyRows(rows) {
  const sorted = rows.slice().sort((a, b) => a.round - b.round);
  if (sorted.some((row, i) => !Number.isInteger(row.round) || row.round < 1 || row.round > 9999 ||
      row.round === sorted[i - 1]?.round || !Array.isArray(row.numbers) || row.numbers.length !== 6 ||
      row.numbers.some((n, j) => !Number.isInteger(n) || n < 1 || n > 45 || (j && n <= row.numbers[j - 1])))) {
    throw Error('회차가 중복되었거나 1~45의 서로 다른 번호 6개가 필요합니다.');
  }
  return sorted;
}

export function studySettings(rows, {
  trainStart = 1, developmentEnd = DEVELOPMENT_END, evalStart = developmentEnd + 1,
  evalEnd = rows.at(-1)?.round ?? 0, window = 0,
} = {}) {
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (!integer(trainStart, 1, 9999) || !integer(developmentEnd, trainStart, 9998) ||
      !integer(evalStart, developmentEnd + 1, 9999) || !integer(evalEnd, 0, 9999) ||
      (window !== 0 && !integer(window, WARMUP, 9999))) {
    throw Error('학습 시작·개발 종료·평가 기간과 이동 학습창(최소 50회)을 확인해 주세요.');
  }
  return { trainStart, developmentEnd, evalStart, evalEnd, window };
}

export function sessionHistory(settings) {
  return newHistory(settings.window || Infinity);
}

export function canForecast(history, round) {
  return history.contiguous >= WARMUP && history.lastRound === round - 1;
}

export function evaluationSchedule(rows, settings) {
  const history = sessionHistory(settings);
  const units = [];
  const exclusions = [];
  const data = new Map(rows.map(row => [row.round, row]));
  for (const row of rows) {
    if (row.round >= settings.evalStart) break;
    if (row.round >= settings.trainStart) addDraw(history, row);
  }
  let last = history.lastRound;
  let contiguous = history.contiguous;
  for (let round = settings.evalStart; round <= settings.evalEnd; round++) {
    const row = data.get(round);
    if (!row) {
      exclusions.push({ round, reason: 'missing-result' });
      continue;
    }
    const eligible = last === round - 1 && contiguous >= WARMUP;
    units.push({ row, eligible });
    if (!eligible) exclusions.push({ round, reason: 'insufficient-contiguous-history' });
    contiguous = last === round - 1 ? contiguous + 1 : 1;
    last = round;
  }
  return { history, units, exclusions };
}
