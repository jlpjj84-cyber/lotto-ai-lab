import { backtest } from './research-backtest.js';
import { simulatePatterns } from './research-simulation.js';
import { simulateStrategies } from './strategy-simulation.js';
import { datasetStamp } from './research-provenance.js';

self.addEventListener('message', async ({ data }) => {
  const { kind, job } = data;
  let updated = 0;
  const progress = (done, total) => {
    const now = performance.now();
    if (now - updated < 180 && done !== total) return;
    updated = now;
    self.postMessage({ progress: done / total });
  };
  try {
    const executedAtUTC = new Date().toISOString();
    let result;
    if (kind === 'simulation') result = simulatePatterns(job, progress);
    else {
      result = kind === 'strategy-simulation' ? simulateStrategies(job, progress) : backtest(job.rows, progress, job.settings);
      result.data = await datasetStamp(job.rows);
      if (kind === 'strategy-simulation') result.executedAtUTC = executedAtUTC;
    }
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
});
