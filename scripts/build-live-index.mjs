import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluationPath, parseArchive, predictionPath, receiptPath, scheduleFor, verifyEvaluation, verifyReceipt } from './live-core.mjs';
import { commitEvidence, listRounds } from './live-predictions.mjs';
import { summarizeLive } from '../assets/live-summary.js';

function verifyCommit(round, record, receipt, root) {
  verifyReceipt(record, receipt);
  const evidence = commitEvidence(round, root);
  assert.equal(evidence.sha, receipt.commit, '확정 GitHub 커밋과 일치하지 않습니다.');
}

export function catalog(root = fileURLToPath(new URL('../', import.meta.url))) {
  const file = path => join(root, path);
  const read = path => JSON.parse(readFileSync(file(path), 'utf8'));
  const draws = parseArchive(readFileSync(file('data/draws.json')));
  const byRound = new Map(draws.map(row => [row.round, row]));
  const rounds = [];
  for (const round of listRounds('predictions', root)) {
    const entry = { round, date: scheduleFor(round).date, state: 'unconfirmed', prediction: null, receipt: null, evaluation: null };
    try {
      const record = read(predictionPath(round));
      assert.equal(record.round, round, '예측 회차와 파일명이 다릅니다.');
      if (existsSync(file(receiptPath(round)))) {
        const receipt = read(receiptPath(round));
        verifyCommit(round, record, receipt, root);
        entry.state = 'confirmed';
        entry.prediction = record;
        entry.receipt = receipt;
        if (existsSync(file(evaluationPath(round)))) {
          const evaluation = read(evaluationPath(round));
          verifyEvaluation(evaluation, record, receipt, byRound.get(round));
          entry.state = 'evaluated';
          entry.evaluation = evaluation;
        }
      }
    } catch (error) {
      entry.state = 'invalid';
      entry.prediction = null;
      entry.receipt = null;
      entry.evaluation = null;
      console.warn(`Pages: ${round}회 무효: ${error.message}`);
    }
    rounds.push(entry);
  }
  const health = existsSync(file('data/live-health.json')) ? read('data/live-health.json') : { schema: 1 };
  return { schema: 1, latestDrawRound: draws.at(-1).round, builtAtUTC: new Date().toISOString(), health, rounds };
}

export function buildLivePages(destination, root) {
  const data = catalog(root);
  mkdirSync(destination, { recursive: true });
  const index = { ...data, summary: summarizeLive(data.rounds.flatMap(row => row.evaluation ? [row.evaluation] : [])),
    rounds: data.rounds.map(({ prediction, receipt, evaluation, ...summary }) => summary) };
  writeFileSync(join(destination, 'index.json'), `${JSON.stringify(index)}\n`);
  for (const row of data.rounds) writeFileSync(join(destination, `${row.round}.json`), `${JSON.stringify(row)}\n`);
  console.log(`Pages: 확정·평가 상태 ${data.rounds.length}회 공개`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  assert(process.argv[2], 'Pages 출력 경로가 필요합니다.');
  buildLivePages(process.argv[2]);
}
