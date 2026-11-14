import { backtest } from './research-backtest.js';
import { simulatePatterns } from './research-simulation.js';

self.addEventListener('message', ({ data }) => {
  const { kind, job } = data;
  let updated = 0;
  const progress = (done, total) => {
    const now = performance.now();
    if (now - updated < 180 && done !== total) return;
    updated = now;
    self.postMessage({ progress: done / total });
  };
  try {
    const result = kind === 'simulation' ? simulatePatterns(job, progress) : backtest(job, progress);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
});
