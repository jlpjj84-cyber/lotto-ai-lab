import { createAutoSnapshot } from './chain-auto-record.js';

self.addEventListener('message', async ({ data: { rows, options, nowUTC } }) => {
  let updated = 0;
  const progress = fraction => {
    const now = performance.now();
    if (now - updated < 150 && fraction !== 1) return;
    updated = now; self.postMessage({ progress: fraction });
  };
  try { self.postMessage({ result: await createAutoSnapshot(rows, options, progress, new Date(nowUTC)) }); }
  catch (error) { self.postMessage({ error: error.message }); }
});
