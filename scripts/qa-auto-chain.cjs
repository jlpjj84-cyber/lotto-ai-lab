// Optional local UI checks; Playwright is a development tool, not a site dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.LOTTO_PLAYWRIGHT_PATH || process.cwd()] }));
const root = path.resolve(__dirname, '../.test-tmp/auto-site');
const prefix = '/lotto-ai-lab/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    const file = path.resolve(root, url.pathname.slice(prefix.length) || 'index.html');
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    try { res.writeHead(200, { 'Content-Type': `${mime[path.extname(file)] || 'text/plain'}; charset=utf-8` }).end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.LOTTO_BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined), headless: true });
    for (const [width, mode] of [[1365, 'server'], [390, 'browser'], [360, 'failure']]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
      const page = await context.newPage(), errors = [], failures = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400 && !(mode !== 'server' && r.url().endsWith('data/chain-auto/latest.json'))) failures.push(r.url()); });
      if (mode !== 'server') await page.route('**/data/chain-auto/latest.json', r => r.fulfill({ status: 503, json: { unavailable: true } }));
      if (mode === 'failure') await page.route('**/assets/chain-auto-worker.js', r => r.abort());
      await page.clock.setFixedTime(new Date('2026-11-22T02:00:00Z'));
      await page.addInitScript(() => { localStorage.setItem('lotto-auto-test-keep', 'original'); });
      const started = Date.now();
      await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
      await page.evaluate(async () => { window.qaService = (await import('./assets/chain-auto-service.js')).getAutoChainService(); });
      await page.waitForFunction(() => window.qaService.getState().phase === 'ready' && window.qaService.getState().record?.data.last === 1251, null, { timeout: 30000 });
      const elapsed = Date.now() - started;
      const initial = await page.evaluate(() => ({ source: window.qaService.getState().source, record: window.qaService.getState().record,
        purchase: localStorage.getItem('lotto_lab_v3_private_records') }));
      assert.equal(initial.source, mode === 'failure' ? 'fallback' : mode);
      assert.equal(await page.locator('[data-auto-chain="overview"] .recommendation-game').count(), 5);
      assert.equal(await page.locator('#manualStrategy option').count(), 10);
      assert.equal(initial.record.result.model.target, 1252);
      if (mode !== 'failure') {
        assert.equal(initial.record.result.validation.n, 251);
        assert.equal(initial.record.result.model.scores.length, 45);
        assert.ok(initial.record.result.recommendation.trace.every(t => t.method === 'ranked' && t.decisions.length === 6 && t.shared === false));
        await page.locator('[data-auto-chain="overview"] [data-score-table] > summary').click();
        assert.equal(await page.locator('[data-auto-chain="overview"] [data-score-table] tbody tr').count(), 45);
        await page.locator('[data-auto-chain="overview"] [data-auto-mode]').selectOption('control');
        assert.ok((await page.locator('[data-auto-chain="overview"] .recommendation-game h3').allTextContents()).every(t => t.includes('무작위 대조군')));
        await page.locator('[data-auto-chain="overview"] [data-auto-mode]').selectOption('evidence');
        assert.ok((await page.locator('[data-auto-chain="overview"] .recommendation-game h3').allTextContents()).every(t => t.includes('분석 점수 순위')));
        await page.locator('[data-auto-chain="overview"] .recommendation-detail').first().locator('summary').click();
        assert.equal(await page.locator('[data-auto-chain="overview"] .recommendation-detail').first().locator('tbody tr').count(), 6);
        await page.locator('[data-auto-chain="overview"] [data-auto-generator]').click();
        assert.equal(await page.locator('#manualStrategy').inputValue(), 'chain-experiment');
        await page.locator('#manualGenerate').click();
        await page.locator('#manualGenStatus').getByText('생성 기록에 저장했습니다.').waitFor();
        assert.equal(await page.locator('#manualGenOutput .recommendation-game').count(), 5);
        await page.locator('#manualCopyReport').click();
        assert.match(await page.evaluate(() => navigator.clipboard.readText()), /10번째 연쇄 패턴 기반 실험 추천/);
        await page.locator('#manualChainMode').selectOption('control');
        await page.locator('#manualGenerate').click();
        await page.locator('#manualGenStatus').getByText('생성 기록에 저장했습니다.').waitFor();
        assert.ok((await page.locator('#manualGenOutput .recommendation-game h3').allTextContents()).every(t => t.includes('무작위 대조군')));
        await page.locator('[data-tab="archive"]').click();
        await page.locator('#archiveRecommendations').getByText(/연쇄 패턴 기반 실험 추천.*SHA-256 일치/).first().waitFor();
        await page.locator('[data-tab="chains"]').click();
        await page.locator('.chain-advanced > summary').click();
        await page.locator('#chainRun').click();
        await page.locator('#chainPatterns tbody tr').first().waitFor();
        assert.equal(await page.locator('#chainPatterns tbody tr').count(), 12);
        await page.locator('.chain-advanced > summary').click();
        await page.locator('[data-auto-chain="lab"] [data-auto-export]').click();
        // Duplicate update notifications are deduplicated; an actual new input
        // cancels work, and the final event restores the correct source snapshot.
        await page.evaluate(() => {
          const rows = window.lottoResearchDraws;
          window.dispatchEvent(new CustomEvent('lotto-draws-changed', { detail: rows.filter(r => r.round <= 1250) }));
          setTimeout(() => window.dispatchEvent(new CustomEvent('lotto-draws-changed', { detail: rows })), 30);
        });
        await page.waitForFunction(() => window.qaService.getState().phase === 'ready' && window.qaService.getState().record?.data.last === 1251);
        await page.reload();
        await page.evaluate(async () => { window.qaService = (await import('./assets/chain-auto-service.js')).getAutoChainService(); });
        await page.waitForFunction(() => window.qaService.getState().phase === 'ready' && window.qaService.getState().source === 'cache');
      } else {
        assert.equal(initial.record.result.model.fallback, true); assert.equal(initial.record.result.validation.pValue, null);
        assert.equal(initial.record.result.recommendation.lines.length, 0);
        assert.equal(initial.record.result.control.lines.length, 5);
        assert.match(await page.locator('[data-auto-chain="overview"] [data-auto-status]').innerText(), /분석 실패/);
      }
      assert.equal(await page.evaluate(() => localStorage.getItem('lotto-auto-test-keep')), 'original');
      assert.equal(await page.evaluate(() => localStorage.getItem('lotto_lab_v3_private_records')), initial.purchase);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      await page.locator('[data-tab="chains"]').click();
      await page.screenshot({ path: path.resolve(__dirname, `../.test-tmp/auto-chain-${width}.png`), fullPage: true });
      assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      console.log(JSON.stringify({ width, mode, elapsedMs: elapsed, automatic: true, noManualInput: true, strategies: 10, preservedPurchases: true, errors }));
      await context.close();
    }
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
