import { studyRows } from './research-study.js';

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

export async function researchDigest(value) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
}

export async function datasetStamp(input) {
  const rows = studyRows(input).map(row => [
    row.round, row.date ?? null, row.numbers, row.bonus ?? null, row.prizes ?? null,
  ]);
  return { first: rows[0]?.[0] ?? null, last: rows.at(-1)?.[0] ?? null,
    count: rows.length, sha256: await researchDigest(rows) };
}

export async function sealResearch(value) {
  const payload = JSON.parse(JSON.stringify(value));
  delete payload.sha256;
  return { ...payload, sha256: await researchDigest(payload) };
}

export async function verifiedResearch(value) {
  if (!value || !/^[0-9a-f]{64}$/.test(value.sha256)) return false;
  const { sha256, ...payload } = value;
  return sha256 === await researchDigest(payload);
}
