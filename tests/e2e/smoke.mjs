// Browser smoke test: serves docs/ with synthetic market data and clicks through every page.
// Run: node tests/e2e/smoke.mjs   (needs the `playwright` package and a Chromium build)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs');

// ---------------------------------------------------------------- synthetic data
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
function series(seed, start, drift) {
  const dates = [], close = [];
  let v = start, x = seed;
  for (let d = new Date('2020-01-01T00:00:00Z'); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    x = (x * 9301 + 49297) % 233280; // deterministic pseudo-random walk
    v *= 1 + drift + ((x / 233280) - 0.5) * 0.02;
    dates.push(iso(d)); close.push(Math.round(v * 100) / 100);
  }
  return { dates, close };
}
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo.json'), 'utf8'));
const tickers = [...new Set(demo.transactions.map((t) => t.ticker).filter(Boolean))];
const ccyOf = (t) => (t.endsWith('.WA') ? 'PLN' : /\.(DE|PA|AS)$/.test(t) ? 'EUR' : t.endsWith('.L') ? 'GBP' : 'USD');
const priceOf = Object.fromEntries(demo.transactions.filter((t) => t.price).map((t) => [t.ticker, t.price]));
const data = { 'meta.json': { generated_at: today.toISOString(), tickers, benchmarks: { '^GSPC': 'S&P 500' }, files: {}, isins: {} }, 'quotes.json': {} };
[...tickers, '^GSPC'].forEach((t, i) => {
  const h = { ticker: t, currency: ccyOf(t), ...series(i + 7, priceOf[t] || 100, 0.0003), dividends: [[iso(new Date(today - 100 * 864e5)), 0.5]], splits: [] };
  const f = `history/${t.replace(/[^\w.-]/g, '_')}.json`;
  data[f] = h; data['meta.json'].files[t] = f;
  data['quotes.json'][t] = { ticker: t, name: `${t} Corp`, currency: h.currency, sector: i % 2 ? 'Technology' : 'Financial Services', country: h.currency === 'PLN' ? 'Poland' : 'United States', price: h.close.at(-1), prev_close: h.close.at(-2), quote_type: 'EQUITY' };
});
const fxs = { PLN: 0.25, EUR: 1.1, GBP: 1.27 };
data['fx.json'] = Object.fromEntries(Object.entries(fxs).map(([c, v], i) => { const s = series(i + 99, v, 0); return [c, { dates: s.dates, usd: s.close.map((x) => x / 100 * 100) }]; }));
data['nbp.json'] = Object.fromEntries(['USD', 'EUR', 'GBP'].map((c) => [c, { dates: data['fx.json'].PLN.dates, rates: data['fx.json'].PLN.usd.map((u) => (fxs[c] ?? 1) / u) }]));
data['events.json'] = { events: tickers.map((t, i) => ({ ticker: t, type: i % 2 ? 'earnings' : 'dividend', date: iso(new Date(+today + (i + 1) * 3 * 864e5)), title: `${t} — Earnings`, market: 'US', details: {} })) };
data['cpi.json'] = { months: ['2024-01', '2025-01', '2026-01'], yoy: [3.7, 4.9, 2.5] };

// ---------------------------------------------------------------- static server
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/data/')) {
    const body = data[url.slice(6)];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    return res.end(body ? JSON.stringify(body) : '{}');
  }
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

// ---------------------------------------------------------------- browser
const ROUTES = ['dashboard', 'holdings', 'transactions', 'dividends', 'analysis', 'rebalance', 'goals', 'report', 'calendar', 'taxes', 'watchlist', 'settings'];
const failures = [];
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
try {
  for (const lang of ['en', 'pl']) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on('pageerror', (e) => failures.push(`[${lang}] page error: ${e.message}`));
    await page.goto(BASE + '/');
    await page.evaluate(([d, l]) => { localStorage.clear(); localStorage.setItem('scrabfree_v1', JSON.stringify({ ...d, settings: { ...d.settings, lang: l } })); }, [demo, lang]);
    for (const r of ROUTES) {
      await page.goto(`${BASE}/#/${r}`);
      await page.waitForFunction(() => !document.querySelector('#main .loading'), null, { timeout: 15000 }).catch(() => failures.push(`[${lang}] ${r}: still loading`));
      await page.waitForTimeout(300);
      const err = await page.$('#main .card.error');
      if (err) failures.push(`[${lang}] ${r}: ${(await err.innerText()).slice(0, 300)}`);
      if (!(await page.$('#main *'))) failures.push(`[${lang}] ${r}: empty page`);
    }
    if (lang === 'en') {
      await page.goto(`${BASE}/#/dashboard`); await page.waitForSelector('.kpi');
      const kpi = await page.textContent('.kpi');
      if (!/Portfolio value/.test(kpi)) failures.push(`dashboard KPI missing: ${kpi}`);
      await page.goto(`${BASE}/#/transactions?import=1`); await page.waitForSelector('#csvText');
      await page.fill('#csvText', 'date,type,ticker,quantity,price,currency\n2024-01-02,BUY,AAPL,1,150,USD');
      await page.waitForTimeout(300);
      if (!/1\s*transactions ready/.test(await page.textContent('#preview'))) failures.push('import preview did not parse the CSV');
    } else {
      await page.goto(`${BASE}/#/dashboard`); await page.waitForSelector('.kpi');
      if (!/Wartość portfela/i.test(await page.textContent('.kpi'))) failures.push('Polish translation not applied on the dashboard');
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.error('E2E FAILURES:\n' + failures.join('\n')); process.exit(1); }
console.log(`e2e ok: ${ROUTES.length} pages × 2 languages`);
