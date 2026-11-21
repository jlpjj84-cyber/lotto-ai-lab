import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createAutoSnapshot, verifyAutoSnapshot, confirmedAutoInput } from '../assets/chain-auto-record.js';
import { parseArchive } from './live-core.mjs';

const rootDefault = fileURLToPath(new URL('../', import.meta.url));
function atomicFile(path, bytes, createOnly = false) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, bytes, { flag: 'wx' });
  try {
    if (createOnly) linkSync(temp, path); else renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
export async function updateAutomaticChain({ root = rootDefault, destination = join(root, 'data/chain-auto'),
  now = new Date(), analyze = createAutoSnapshot, options = {} } = {}) {
  mkdirSync(destination, { recursive: true });
  const lock = join(destination, '.lock'), latestPath = join(destination, 'latest.json'), healthPath = join(destination, 'health.json');
  // The existing Actions concurrency group serializes repository writers. This
  // local exclusive lock also refuses overlapping manual/process invocations.
  writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' });
  let sourceRound = null;
  try {
    const rows = parseArchive(readFileSync(join(root, 'data/draws.json')));
    confirmedAutoInput(rows, now); sourceRound = rows.at(-1).round;
    const source = join(root, 'data/chain-auto/latest.json');
    let record;
    for (const path of [latestPath, source]) if (!record && existsSync(path)) {
      try {
        const previous = JSON.parse(readFileSync(path, 'utf8'));
        if (previous.result?.analysisState !== 'failed' && await verifyAutoSnapshot(previous, rows, options)) record = previous;
      } catch { /* A new snapshot is generated without deleting the previous one. */ }
    }
    if (!record) record = await analyze(rows, options, () => {}, now);
    if (!await verifyAutoSnapshot(record, rows, options) || record.result.analysisState === 'failed') throw Error('자동 연구 결과 검증에 실패했습니다.');
    const bytes = JSON.stringify(record) + '\n';
    // Only the repository writer keeps immutable historical snapshots. A Pages
    // artifact exposes the latest aggregate without copying repository history.
    if (resolve(destination) === resolve(root, 'data/chain-auto')) {
      const archive = join(destination, 'snapshots'); mkdirSync(archive, { recursive: true });
      const path = join(archive, `${record.data.last}-${record.id}.json`);
      if (existsSync(path)) {
        const previous = JSON.parse(readFileSync(path, 'utf8'));
        if (!await verifyAutoSnapshot(previous, rows, options)) throw Error('기존 자동 연구 스냅샷 검증 실패: 덮어쓰지 않았습니다.');
        record = previous;
      } else atomicFile(path, bytes, true);
    }
    atomicFile(latestPath, JSON.stringify(record) + '\n');
    atomicFile(healthPath, JSON.stringify({ schema: 1, state: record.result.model.fallback ? 'fallback' : 'ok', latest: sourceRound,
      inputSha256: record.data.sha256, checkedAtUTC: now.toISOString(), predictionAdvantage: record.result.validation.status }) + '\n');
    return record;
  } catch (error) {
    atomicFile(healthPath, JSON.stringify({ schema: 1, state: 'error', latest: sourceRound,
      checkedAtUTC: now.toISOString(), reason: error.message, previousReportPreserved: true }) + '\n');
    throw error;
  } finally { unlinkSync(lock); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const record = await updateAutomaticChain({ destination: process.argv[2] ? resolve(process.argv[2]) : undefined });
    console.log(`자동 연쇄: 1~${record.data.last}회 → ${record.result.model.target}회, ${record.result.validation.status}`);
  } catch (error) { console.error(`자동 연쇄 갱신 실패: ${error.message}`); process.exitCode = 1; }
}
