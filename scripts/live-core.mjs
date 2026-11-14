import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_SEED } from '../assets/research-math.js';
import { forecastAt, GAMES_PER_DRAW, STRATEGIES, STRATEGY_VERSION } from '../assets/lotto-strategies.js';
import { scoreTickets } from '../assets/lotto-scoring.js';
import { KST, roundOnSaturday, scheduleFor } from '../assets/lotto-calendar.js';

export { roundOnSaturday, scheduleFor } from '../assets/lotto-calendar.js';
export const REPO = 'jlpjj84-cyber/lotto-ai-lab';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => sha256(JSON.stringify(value));
const fixedSettings = Object.freeze({ seed: DEFAULT_SEED, gamesPerStrategy: GAMES_PER_DRAW, sharedFifthGame: true, version: STRATEGY_VERSION });

export function predictionPath(round) { return `data/predictions/${round}.json`; }
export function receiptPath(round) { return `data/prediction-receipts/${round}.json`; }
export function evaluationPath(round) { return `data/evaluations/${round}.json`; }
export function statusContext(round) { return `lotto-lab/pre-draw/${round}`; }

function validNumbers(numbers) {
  return Array.isArray(numbers) && numbers.length === 6 && numbers.every((n, i) =>
    Number.isInteger(n) && n >= 1 && n <= 45 && (i === 0 || numbers[i - 1] < n));
}

export function validateDraw(row) {
  const when = scheduleFor(row.round);
  assert(row.date === when.date && validNumbers(row.numbers) && Number.isInteger(row.bonus) &&
    row.bonus >= 1 && row.bonus <= 45 && !row.numbers.includes(row.bonus), `추첨 자료 오류: ${row.round}회`);
  assert(row.prizes == null || (typeof row.prizes === 'object' && !Array.isArray(row.prizes) &&
    Object.entries(row.prizes).every(([key, value]) => /^[1-5]$/.test(key) && Number.isSafeInteger(value) && value >= 0)),
    `당첨금 형식 오류: ${row.round}회`);
  return row;
}

export function parseArchive(bytes) {
  const { draws } = JSON.parse(bytes.toString());
  assert(Array.isArray(draws) && draws.length, '확정 회차 자료가 없습니다.');
  const rows = draws.map(validateDraw).sort((a, b) => a.round - b.round);
  assert(rows.every((r, i) => i === 0 || rows[i - 1].round !== r.round), '중복 회차가 있습니다.');
  return rows;
}

export function sameDraw(left, right) {
  return !!left && !!right && left.round === right.round && left.date === right.date && left.bonus === right.bonus &&
    left.numbers.every((number, i) => number === right.numbers[i]);
}

export function createPrediction(bytes, now, officialLatest, runId) {
  const when = roundOnSaturday(now);
  assert(when && now >= new Date(when.opensUTC) && now < new Date(when.cutoffUTC), '토요일 18:00~20:00 KST에만 예측을 확정할 수 있습니다.');
  assert(typeof runId === 'string' && /^[0-9]+$/.test(runId), 'GitHub Actions 실행 번호가 필요합니다.');
  const rows = parseArchive(bytes);
  const last = rows.at(-1);
  assert(last.round === when.round - 1, '최신 확정 회차가 대상의 직전 회차와 일치하지 않습니다.');
  assert(sameDraw(last, officialLatest), '동행복권의 최신 확정 회차를 대조하지 못했습니다.');
  const picks = forecastAt(rows, when.round);
  assert(picks, '직전 연속 50회 자료가 필요합니다.');
  const data = {
    schema: 1, round: when.round, drawDate: when.date, cutoffUTC: when.cutoffUTC, runId,
    generatedAtUTC: now.toISOString(), generatedAtKST: new Date(now.getTime() + KST).toISOString().replace('Z', '+09:00'),
    latestFinalRound: last.round, history: { first: rows[0].round, last: last.round, count: rows.length },
    dataSha256: sha256(bytes), settings: fixedSettings,
    strategies: STRATEGIES.map(([id], index) => ({ id, version: STRATEGY_VERSION, games: picks[index] })),
  };
  return { ...data, sha256: digest(data) };
}

export function verifyPrediction(record, bytes) {
  const { sha256: checksum, ...data } = record;
  assert.equal(checksum, digest(data), '예측 SHA-256이 일치하지 않습니다.');
  assert(record.strategies?.length === STRATEGIES.length && record.strategies.every(strategy =>
    strategy.games?.length === GAMES_PER_DRAW && strategy.games.every(validNumbers)), '전략별 5게임 형식이 일치하지 않습니다.');
  const last = parseArchive(bytes).at(-1);
  // The committed input snapshot is the proof here. The live caller checks the official feed before writing.
  assert.deepEqual(record, createPrediction(bytes, new Date(record.generatedAtUTC), last, record.runId), '확정 커밋 입력에서 예측을 재현할 수 없습니다.');
  return record;
}

export function verifyStatus(record, sha, status) {
  const when = scheduleFor(record.round);
  const created = Date.parse(status?.created_at);
  assert(/^[a-f0-9]{40}$/.test(sha) && status?.creator?.login === 'github-actions[bot]' &&
    status.state === 'success' && status.context === statusContext(record.round) &&
    status.description === `sha256:${record.sha256}` && Number.isSafeInteger(status.id) && status.id > 0 &&
    status.target_url === `https://github.com/${REPO}/actions/runs/${record.runId}`, 'GitHub 확인 기록이 일치하지 않습니다.');
  // GitHub's timestamp has seconds precision. The write can occur in the same second as generation.
  assert(Number.isFinite(created) && created >= Math.floor(Date.parse(record.generatedAtUTC) / 1000) * 1000 &&
    created >= Date.parse(when.opensUTC) && created < Date.parse(when.cutoffUTC), '마감 전 GitHub 확정 시각이 확인되지 않았습니다.');
  return { schema: 1, round: record.round, predictionSha256: record.sha256, commit: sha, statusId: status.id,
    confirmedAtUTC: status.created_at, workflow: status.target_url };
}

export function verifyReceipt(record, receipt) {
  assert(receipt?.schema === 1 && receipt.round === record.round && receipt.predictionSha256 === record.sha256,
    '예측과 GitHub 확인 기록이 일치하지 않습니다.');
  verifyStatus(record, receipt.commit, { id: receipt.statusId, creator: { login: 'github-actions[bot]' }, state: 'success',
    context: statusContext(record.round), description: `sha256:${record.sha256}`, created_at: receipt.confirmedAtUTC, target_url: receipt.workflow });
}

export function evaluatePrediction(record, receipt, official, archived, now) {
  verifyReceipt(record, receipt);
  validateDraw(official);
  assert(sameDraw(official, archived) && official.round === record.round, '공식 결과와 공개 아카이브가 일치하지 않습니다.');
  assert(now >= new Date(`${record.drawDate}T11:35:00Z`), '아직 추첨 결과를 평가할 시각이 아닙니다.');
  const data = {
    schema: 1, round: record.round, evaluatedAtUTC: now.toISOString(), predictionSha256: record.sha256,
    commit: receipt.commit, official: { round: official.round, date: official.date, numbers: official.numbers,
      bonus: official.bonus, prizes: official.prizes || {} },
    strategies: record.strategies.map(({ id, games }) => ({ id, ...scoreTickets(games, official) })),
  };
  return { ...data, sha256: digest(data) };
}

export function verifyEvaluation(evaluation, prediction, receipt, archived) {
  assert.deepEqual(evaluation, evaluatePrediction(prediction, receipt, evaluation.official, archived,
    new Date(evaluation.evaluatedAtUTC)), '평가 내용 또는 해시가 일치하지 않습니다.');
}
