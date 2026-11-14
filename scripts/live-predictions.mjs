import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPrediction, evaluatePrediction, evaluationPath, parseArchive, predictionPath, receiptPath, REPO,
  roundOnSaturday, scheduleFor, statusContext, verifyEvaluation, verifyPrediction, verifyStatus,
} from './live-core.mjs';
import { EPOCH, KST, WEEK } from '../assets/lotto-calendar.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const archivePath = 'data/draws.json';
const now = () => new Date();
const workflowPath = '.github/workflows/update.yml';
const healthPath = 'data/live-health.json';
const full = path => join(root, path);
const json = path => JSON.parse(readFileSync(full(path), 'utf8'));
const serialized = value => `${JSON.stringify(value, null, 2)}\n`;
const cutoff = when => Date.parse(when.cutoffUTC);
const runsUrl = run => `https://github.com/${REPO}/actions/runs/${run}`;

export function writeNew(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized(data), { flag: 'wx' });
}

function setHealth(mode, status, round, reason) {
  const data = existsSync(full(healthPath)) ? json(healthPath) : { schema: 1 };
  data[mode] = { status, round, reason, checkedAtUTC: now().toISOString(), workflow: runsUrl(process.env.GITHUB_RUN_ID) };
  const temp = full(`${healthPath}.tmp`);
  writeFileSync(temp, serialized(data));
  renameSync(temp, full(healthPath));
  console.log(`[${mode}] ${status} ${round ?? ''} ${reason}`);
}

function updateDrawArchive() {
  const fields = ['round', 'date', 'numbers', 'bonus'];
  const args = ['-B', 'scripts/update_draws.py'];
  if (process.env.MANUAL_ROUND) for (const field of fields) args.push(`--manual-${field}`, process.env[`MANUAL_${field.toUpperCase()}`] || '');
  const result = spawnSync('python', args, { cwd: root, stdio: 'inherit', timeout: 195_000 });
  assert.equal(result.status, 0, '공개 추첨 데이터 갱신에 실패했습니다.');
}

function git(args, allowFailure = false, cwd = root) {
  const result = spawnSync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    if (allowFailure) return null;
    // Do not emit remote URLs, command environment, or credential-related stderr.
    throw Error(`git ${args[0]} 실패 (${result.status ?? '시작 실패'})`);
  }
  return result.stdout;
}

function push(paths, message) {
  git(['add', '--', ...paths]);
  if (git(['diff', '--cached', '--quiet'], true) === null) {
    git(['commit', '-m', message]);
    git(['push', 'origin', 'HEAD:refs/heads/main']);
  }
  return git(['rev-parse', 'HEAD']).toString().trim();
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    method: options.method || 'GET', body: options.body && JSON.stringify(options.body),
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'LottoLab-4.1' },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `GitHub ${options.method || 'GET'} ${path.split('/')[0]} 응답 ${response.status}`);
  return response.json();
}

function readOfficial(rounds = []) {
  const result = spawnSync('python', ['-B', 'scripts/live_official.py', ...rounds.map(String)], {
    cwd: root, encoding: 'utf8', timeout: 165_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw Error('동행복권 공식 자료를 확인하지 못했습니다.');
  }
  return JSON.parse(result.stdout);
}

export function commitEvidence(round, cwd = root) {
  const path = predictionPath(round);
  const history = git(['log', '--follow', '--format=%H', 'HEAD', '--', path], false, cwd).toString().trim().split(/\s+/).filter(Boolean);
  assert(history.length === 1, `${round}회 예측 파일이 추가된 뒤 변경되었습니다.`);
  const sha = history[0];
  assert(git(['merge-base', '--is-ancestor', sha, 'HEAD'], true, cwd) !== null, '예측 커밋이 main 이력에 없습니다.');
  const committed = git(['show', `${sha}:${path}`], false, cwd);
  assert(committed.equals(readFileSync(join(cwd, path))), '현재 예측 파일과 확정 커밋이 다릅니다.');
  const archive = git(['show', `${sha}:${archivePath}`], false, cwd);
  return { sha, record: verifyPrediction(JSON.parse(committed), archive) };
}

async function verifyRun(record, status, predictionCommit) {
  const run = await github(`actions/runs/${record.runId}`);
  assert(run.path?.split('@')[0] === workflowPath && run.head_branch === 'main' && run.head_repository?.full_name === REPO &&
    ['schedule', 'workflow_dispatch'].includes(run.event) && Date.parse(run.created_at) <= Date.parse(status.created_at) &&
    /^[a-f0-9]{40}$/.test(run.head_sha || '') && git(['merge-base', '--is-ancestor', run.head_sha, predictionCommit], true) !== null,
    'GitHub 서버 확인 기록의 워크플로 출처가 일치하지 않습니다.');
}

async function checkEvidence(round, { attest = false } = {}) {
  const { sha, record } = commitEvidence(round);
  const path = receiptPath(round);
  const existing = existsSync(full(path)) ? json(path) : null;
  const statuses = await github(`commits/${sha}/statuses?per_page=100`);
  assert(Array.isArray(statuses) && statuses.length < 100, 'GitHub 확인 기록 목록을 완전히 읽지 못했습니다.');
  let receipt = null;
  for (const status of statuses) {
    if (status.context !== statusContext(round) || (existing && existing.statusId !== status.id)) continue;
    try { receipt = verifyStatus(record, sha, status); } catch { continue; }
    await verifyRun(record, status, sha);
    break;
  }
  if (!receipt && attest && record.runId === process.env.GITHUB_RUN_ID && now() < new Date(record.cutoffUTC)) {
    const status = await github(`statuses/${sha}`, { method: 'POST', body: {
      state: 'success', context: statusContext(round), description: `sha256:${record.sha256}`,
      target_url: runsUrl(record.runId),
    } });
    receipt = verifyStatus(record, sha, status);
    await verifyRun(record, status, sha);
  }
  if (existing) assert.deepEqual(receipt, existing, 'GitHub 확인 기록을 다시 검증하지 못했습니다.');
  return { record, receipt, newReceipt: receipt && !existing };
}

async function predict() {
  const when = roundOnSaturday(now());
  if (!when) {
    const round = 1 + Math.floor((now().getTime() + KST - EPOCH) / WEEK);
    if (!existsSync(full(receiptPath(round)))) setHealth('predict', 'late', round, '토요일 확정 시간이 지나 새 기록을 만들 수 없습니다.');
    else console.log(`${round}회 예측 확인 기록이 있습니다.`);
    return;
  }
  const { round } = when;
  if (!existsSync(full(predictionPath(round)))) {
    if (now().getTime() >= cutoff(when) || now() < new Date(when.opensUTC)) {
      setHealth('predict', now().getTime() >= cutoff(when) ? 'late' : 'early', round, '토요일 18:00~20:00 KST 확정 시간 밖입니다.');
      return;
    }
    const latest = readOfficial().latest;
    const record = createPrediction(readFileSync(full(archivePath)), now(), latest, process.env.GITHUB_RUN_ID);
    writeNew(full(predictionPath(round)), record);
    push([predictionPath(round)], `data: freeze pre-draw prediction ${round}`);
  }
  const { receipt, newReceipt } = await checkEvidence(round, { attest: true });
  if (newReceipt) writeNew(full(receiptPath(round)), receipt);
  setHealth('predict', receipt ? 'confirmed' : 'unconfirmed', round,
    receipt ? '마감 전 GitHub 커밋 확인 완료' : '마감 전 GitHub 확정 기록 없음');
  if (!receipt) process.exitCode = 1;
}

export function listRounds(directory, cwd = root) {
  const path = join(cwd, 'data', directory);
  if (!existsSync(path)) return [];
  return readdirSync(path).filter(name => /^[1-9][0-9]{0,3}\.json$/.test(name)).map(name => Number(name.slice(0, -5))).sort((a, b) => a - b);
}

async function evaluate() {
  const archive = new Map(parseArchive(readFileSync(full(archivePath))).map(row => [row.round, row]));
  const all = listRounds('predictions');
  const attempted = all.filter(round => now().getTime() >= cutoff(scheduleFor(round)) &&
    (!existsSync(full(evaluationPath(round))) || json(evaluationPath(round)).strategies.some(row => row.unpriced)));
  if (!attempted.length) {
    setHealth('evaluate', 'idle', all.at(-1) ?? null, '평가할 새 확정 예측이 없습니다.');
    return;
  }
  const pending = [];
  const waiting = [];
  const invalid = [];
  const errors = [];
  for (const round of attempted) {
    try {
      const { record, receipt, newReceipt } = await checkEvidence(round);
      if (newReceipt) writeNew(full(receiptPath(round)), receipt);
      if (receipt) pending.push({ record, receipt });
      else invalid.push(round);
    } catch (error) {
      errors.push(round);
      console.error(`${round}회 확인 실패: ${error.message}`);
    }
  }
  let count = 0;
  if (pending.length) {
    const official = new Map(readOfficial(pending.map(item => item.record.round)).draws.map(row => [row.round, row]));
    for (const { record, receipt } of pending) {
      const round = record.round;
      if (!archive.has(round) || !official.has(round)) { waiting.push(round); continue; }
      try {
        const path = evaluationPath(round);
        const fresh = evaluatePrediction(record, receipt, official.get(round), archive.get(round), now());
        if (existsSync(full(path))) {
          const previous = json(path);
          verifyEvaluation(previous, record, receipt, archive.get(round));
          const oldPrizes = previous.official.prizes;
          for (const [rank, amount] of Object.entries(oldPrizes)) {
            if (amount > 0 && fresh.official.prizes[rank] > 0) assert.equal(fresh.official.prizes[rank], amount, '발표된 당첨금과 충돌합니다.');
          }
          const nextDraw = { ...fresh.official, prizes: { ...oldPrizes,
            ...Object.fromEntries(Object.entries(fresh.official.prizes).filter(([, value]) => value > 0)) } };
          const updated = evaluatePrediction(record, receipt, nextDraw, archive.get(round), now());
          if (updated.strategies.reduce((sum, row) => sum + row.unpriced, 0) >= previous.strategies.reduce((sum, row) => sum + row.unpriced, 0)) {
            waiting.push(round);
            continue;
          }
          const revision = `data/evaluation-revisions/${round}/${previous.sha256}.json`;
          writeNew(full(revision), previous);
          writeFileSync(full(path), serialized(updated));
        } else writeNew(full(path), fresh);
        count++;
      } catch (error) {
        errors.push(round);
        console.error(`${round}회 평가 실패: ${error.message}`);
      }
    }
  }
  const note = [`${count}회 평가`, waiting.length ? `결과·금액 대기 ${waiting.join(', ')}` : '',
    invalid.length ? `마감 증빙 없음 ${invalid.join(', ')}` : '', errors.length ? `검증 실패 ${errors.join(', ')}` : ''].filter(Boolean).join(' · ');
  setHealth('evaluate', errors.length ? 'error' : waiting.length ? 'waiting' : 'checked', attempted.at(-1), note);
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  assert(['predict', 'evaluate'].includes(mode) && process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === REPO &&
    process.env.GITHUB_REF === 'refs/heads/main' && /^[0-9]+$/.test(process.env.GITHUB_RUN_ID || '') && process.env.GH_TOKEN,
    '실전 기록은 대상 저장소의 main GitHub Actions에서만 처리합니다.');
  try {
    if (mode === 'predict') await predict();
    else {
      updateDrawArchive();
      await evaluate();
    }
  } catch (error) {
    setHealth(mode, 'error', mode === 'predict' ? roundOnSaturday(now())?.round ?? null : null, error.message);
    console.error(error.message);
    process.exitCode = 1;
  }
}
