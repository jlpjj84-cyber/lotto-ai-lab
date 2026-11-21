const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.LOTTO_PLAYWRIGHT_PATH || process.cwd()] }));

const source = path.resolve(__dirname, '..');
const root = path.join(source, '.test-tmp/site');
const prefix = '/lotto-ai-lab/';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    const file = path.resolve(root, pathname.slice(prefix.length) || 'index.html');
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    try {
      let bytes = await fs.readFile(file);
      if (file === path.join(root, 'data/draws.json')) {
        const data = JSON.parse(bytes);
        data.draws = data.draws.filter(row => row.round <= 1250);
        bytes = Buffer.from(JSON.stringify(data)); // local historical fixture only
      }
      res.writeHead(200, { 'Content-Type': (mime[path.extname(file)] || 'text/plain') + '; charset=utf-8' }).end(bytes);
    }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.LOTTO_BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined), headless: true });
    console.log(JSON.stringify({ browser: browser.version(), historicalFixture: '1-1250' }));
    for (const width of [1365, 390, 360]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Seoul', acceptDownloads: true });
      const page = await context.newPage();
      const errors = [], badResponses = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) badResponses.push(response.url()); });
      await page.clock.setFixedTime(new Date('2026-11-15T02:00:00Z'));
      await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
      await page.waitForFunction(() => window.lottoResearchDraws?.length === 1250);
      await page.evaluate(() => {
        localStorage.setItem('lotto_lab_v3_private_records', JSON.stringify([{ id: 'preserve-me', targetRound: 1250, numbers: [1, 2, 3, 4, 5, 6] }]));
        localStorage.setItem('lotto_lab_v41_generated_records', '[]');
        localStorage.setItem('lotto52-test-marker', 'existing-data');
        window.chainLongTasks = [];
        new PerformanceObserver(list => window.chainLongTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: false });
      });
      const stored = await page.evaluate(() => ({ ...localStorage }));
      await page.locator('[data-tab="chains"]').click();
      await page.locator('#chainMatrixNote').getByText(/유효 창 999개/).waitFor();
      assert.equal(await page.locator('#chainLength').inputValue(), '10');
      let started = Date.now();
      await page.locator('#chainRun').click();
      await page.locator('#chainForecast').getByText('무작위 기준 대비 예측력 개선 확인 없음').waitFor();
      const analysisMs = Date.now() - started;
      assert.equal(await page.locator('#chainPatterns tbody tr').count(), 12);
      assert.match(await page.locator('#chainForecast').innerText(), /0.8000/);
      assert.match(await page.locator('#chainForecast').innerText(), /0.7976/);
      await page.locator('.chain-pattern').first().click();
      await page.locator('#chainDetail h3').getByText(/42.*19.*21/).waitFor();
      assert.match(await page.locator('#chainDetail').innerText(), /조건 발생 1회/);
      assert.equal(await page.locator('#chainDetail .chain-eventline > span').count(), 9);
      await page.locator('#chainDetail details').first().locator('summary').click();
      assert.equal(await page.locator('#chainDetail .chain-occurrences tbody tr').count(), 9);
      await page.locator('#chainA').selectOption('20'); await page.locator('#chainB').selectOption('18');
      await page.locator('#chainMatrixSelect').click();
      await page.locator('#chainDetail h3').getByText(/20.*18/).waitFor();
      assert.match(await page.locator('#chainMatrixNote').innerText(), /34\/139/);
      await page.locator('#chainLag').selectOption('10');
      await page.locator('#chainMatrixNote').getByText(/10회 간격/).waitFor();
      await page.locator('#chainQuery').fill('5,12 / 7 / 9');
      await page.locator('#chainQueryGaps').fill('2,1');
      await page.locator('#chainQueryRun').click();
      await page.locator('#chainDetail h3').getByText(/5\+12.*7.*9/).waitFor();
      assert.match(await page.locator('#chainDetail').innerText(), /탐색용 관계/);
      await page.locator('#chainQuery').fill('5 / 99'); await page.locator('#chainQueryGaps').fill('');
      await page.locator('#chainQueryRun').click();
      await page.locator('#chainStatus').getByText(/본번호/).waitFor();
      // All MC work happens off the main thread and cancel remains reachable.
      started = Date.now();
      await page.locator('#chainValidate').click();
      await page.locator('#chainMC').getByText(/10,000회/).waitFor({ timeout: 30000 });
      const simulationMs = Date.now() - started;
      assert.match(await page.locator('#chainMC').innerText(), /0개 통과/);
      await page.locator('#chainMC summary').click();
      assert.equal(await page.locator('#chainMC tbody tr').count(), 12);
      const downloadEvent = page.waitForEvent('download'); await page.locator('#chainExport').click();
      const download = await downloadEvent;
      const exported = JSON.parse(await fs.readFile(await download.path()));
      assert.equal(exported.analysis.forecast.n, 250); assert.equal(exported.validation.repetitions, 10000);
      assert.equal(exported.analysis.settings.developmentEnd, 1000);
      // Repeating exactly the same job returns cached results.
      started = Date.now(); await page.locator('#chainValidate').click();
      await page.waitForFunction(() => !document.getElementById('chainRun').disabled);
      const cachedMs = Date.now() - started;
      assert.ok(cachedMs < 1200, `cached run too slow: ${cachedMs}`);
      // Unreasonable precision is rejected before starting a huge run.
      await page.locator('#chainRepeats').selectOption('100000'); await page.locator('#chainValidate').click();
      await page.locator('#chainStatus').getByText(/안전 한도/).waitFor();
      await page.locator('#chainTopK').fill('3'); await page.locator('#chainTopK').dispatchEvent('change');
      assert.ok(await page.locator('#chainValidate').isDisabled());
      await page.locator('#chainLength').fill('11'); await page.locator('#chainLength').dispatchEvent('change');
      await page.locator('#chainRun').click();
      await page.locator('#chainPatterns tbody tr').first().waitFor();
      assert.equal(await page.locator('#chainPatterns tbody tr').count(), 3);
      await page.locator('#chainValidate').click();
      await page.waitForFunction(() => !document.getElementById('chainCancel').disabled);
      await page.locator('#chainCancel').click();
      await page.locator('#chainStatus').getByText(/취소/).waitFor();
      assert.ok(await page.locator('#chainRun').isEnabled());
      await page.waitForTimeout(100);
      assert.match(await page.locator('#chainMC').innerText(), /미실행/);
      if (width === 1365) {
        started = Date.now(); await page.locator('#chainValidate').click();
        await page.locator('#chainMC').getByText(/100,000회/).waitFor({ timeout: 30000 });
        console.log(JSON.stringify({ precision100000Ms: Date.now() - started }));
      }
      // Restore default view for screenshots.
      await page.locator('#chainTopK').fill('12'); await page.locator('#chainTopK').dispatchEvent('change');
      await page.locator('#chainLength').fill('10'); await page.locator('#chainLength').dispatchEvent('change');
      await page.locator('#chainRun').click();
      await page.locator('#chainPatterns tbody tr').first().waitFor();
      await page.locator('.chain-pattern').first().click();
      await page.locator('#chainDetail h3').waitFor();
      await page.screenshot({ path: path.join(source, `.test-tmp/chain-${width}.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, `page overflow ${width}: ${overflow}`);
      assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), stored);
      const longTasks = await page.evaluate(() => window.chainLongTasks);
      assert.deepEqual(errors, []); assert.deepEqual(badResponses, []);
      console.log(JSON.stringify({ width, analysisMs, simulationMs, cachedMs, overflow, maxMainThreadTaskMs: Math.max(0, ...longTasks), errors, preservedStorage: true, cancel: true, matrix: true, query: true, jsonExport: true }));
      await context.close();
    }
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
