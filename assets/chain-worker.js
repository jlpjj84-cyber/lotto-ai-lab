import { analyzeChains, chainDetail, cleanChainRows, transitionMatrix } from './chain-research.js';
import { validateChains } from './chain-validation.js';
import { datasetStamp } from './research-provenance.js';

self.addEventListener('message', async ({ data: { kind, job } }) => {
  let updated = 0;
  const progress = fraction => {
    const now = performance.now();
    if (now - updated < 180 && fraction !== 1) return;
    updated = now;
    self.postMessage({ progress: fraction });
  };
  try {
    let result;
    if (kind === 'chains') result = analyzeChains(job.rows, job.settings, progress);
    else if (kind === 'chain-simulation') result = validateChains(job.rows, job.analysis, job.repetitions, progress);
    else if (kind === 'chain-detail') result = chainDetail(job.rows, job.stages, job.gaps, job.settings);
    else if (kind === 'chain-matrix') result = transitionMatrix(cleanChainRows(job.rows), job.lag, job.from, job.to);
    else throw Error('알 수 없는 연쇄 연구 작업입니다.');
    result.source = await datasetStamp(job.rows.filter(row => row.round <= (job.settings?.endRound || job.analysis?.settings.endRound || job.to)));
    progress(1);
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error.message }); }
});
