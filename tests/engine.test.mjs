// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Market, Series, computePortfolio, computePolishTax, xirr, periodStats, forecastDividends,
  benchmarkSeries, addDays, groupBy,
} from '../docs/js/engine.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

function daily(start, end, fn) {
  const dates = [], close = [];
  for (let d = start; d <= end; d = addDays(d, 1)) { dates.push(d); close.push(fn(d)); }
  return { dates, close };
}

test('Series lookup at/before', () => {
  const s = new Series(['2024-01-02', '2024-01-05'], [1, 2]);
  assert.equal(s.at('2024-01-01'), null);
  assert.equal(s.at('2024-01-03'), 1);
  assert.equal(s.at('2024-01-05'), 2);
  assert.equal(s.before('2024-01-05'), 1);
});

test('single-currency buy/hold: value, unrealized, TWR', () => {
  const market = new Market({
    quotes: { AAA: { currency: 'PLN' } },
    histories: { AAA: { currency: 'PLN', ...daily('2024-01-01', '2024-01-10', (d) => (d < '2024-01-05' ? 10 : 12)), dividends: [], splits: [] } },
  });
  const r = computePortfolio([
    { portfolioId: 'p', date: '2024-01-02', type: 'BUY', ticker: 'AAA', quantity: 10, price: 10, fee: 0, currency: 'PLN' },
  ], market, { base: 'PLN', today: '2024-01-10' });
  close(r.totals.value, 120);
  close(r.totals.invested, 100);
  close(r.totals.profit, 20);
  close(r.holdings[0].unrealized, 20);
  close(r.totals.twr, 0.2);
});

test('FIFO realized gain and fees', () => {
  const market = new Market({ histories: { AAA: { currency: 'PLN', ...daily('2024-01-01', '2024-03-01', () => 20), dividends: [], splits: [] } } });
  const r = computePortfolio([
    { portfolioId: 'p', date: '2024-01-02', type: 'BUY', ticker: 'AAA', quantity: 10, price: 10, fee: 1, currency: 'PLN' },
    { portfolioId: 'p', date: '2024-01-03', type: 'BUY', ticker: 'AAA', quantity: 10, price: 15, fee: 1, currency: 'PLN' },
    { portfolioId: 'p', date: '2024-02-01', type: 'SELL', ticker: 'AAA', quantity: 15, price: 20, fee: 2, currency: 'PLN' },
  ], market, { base: 'PLN', today: '2024-03-01' });
  // cost of 15 FIFO shares = 10*10+1 + 5*15+0.5 = 176.5 ; proceeds = 300-2 = 298
  close(r.totals.realized, 298 - 176.5);
  close(r.holdings[0].qty, 5);
  close(r.holdings[0].costBase, 75.5);
  close(r.totals.fees, 4);
  // profit = value now + cash taken out - money put in
  close(r.totals.profit, 5 * 20 + 298 - (101 + 151));
});

test('splits: quantity multiplied, value continuous', () => {
  // market data is split-unadjusted: 100 before, 25 after a 4:1 split
  const market = new Market({ histories: { AAA: { currency: 'USD', ...daily('2024-01-01', '2024-01-10', (d) => (d < '2024-01-05' ? 100 : 25)), dividends: [], splits: [['2024-01-05', 4]] } } });
  const r = computePortfolio([
    { portfolioId: 'p', date: '2024-01-02', type: 'BUY', ticker: 'AAA', quantity: 2, price: 100, currency: 'USD' },
  ], market, { base: 'USD', today: '2024-01-10' });
  close(r.holdings[0].qty, 8);
  close(r.holdings[0].avgPrice, 25);
  close(r.totals.twr, 0);
});

test('multi-currency cost basis uses FX at buy date', () => {
  const market = new Market({
    histories: { US: { currency: 'USD', ...daily('2024-01-01', '2024-01-10', () => 10), dividends: [], splits: [] } },
    fx: { PLN: (({ dates, close }) => ({ dates, usd: close }))(daily('2024-01-01', '2024-01-10', (d) => (d < '2024-01-05' ? 0.25 : 0.2))) }, // USD per PLN
  });
  const r = computePortfolio([
    { portfolioId: 'p', date: '2024-01-02', type: 'BUY', ticker: 'US', quantity: 1, price: 10, currency: 'USD' },
  ], market, { base: 'PLN', today: '2024-01-10' });
  close(r.holdings[0].costBase, 40);  // 10 USD * 4 PLN
  close(r.holdings[0].value, 50);     // 10 USD * 5 PLN
  close(r.totals.profit, 10);
});

test('cash mode: deposits are the flows, cash counted in value', () => {
  const market = new Market({ histories: { AAA: { currency: 'PLN', ...daily('2024-01-01', '2024-01-10', (d) => (d < '2024-01-05' ? 10 : 11)), dividends: [], splits: [] } } });
  const r = computePortfolio([
    { portfolioId: 'p', date: '2024-01-01', type: 'DEPOSIT', amount: 1000, currency: 'PLN' },
    { portfolioId: 'p', date: '2024-01-02', type: 'BUY', ticker: 'AAA', quantity: 50, price: 10, fee: 0, currency: 'PLN' },
  ], market, { base: 'PLN', today: '2024-01-10' });
  close(r.totals.invested, 1000);
  close(r.totals.cashValue, 500);
  close(r.totals.value, 1050);
  close(r.totals.twr, 0.05);
});

test('auto dividends from market data when none recorded', () => {
  const market = new Market({ histories: { AAA: { currency: 'PLN', ...daily('2024-01-01', '2024-03-01', () => 10), dividends: [['2024-02-01', 0.5]], splits: [] } } });
  const txs = [{ portfolioId: 'p', date: '2024-01-02', type: 'BUY', ticker: 'AAA', quantity: 10, price: 10, currency: 'PLN' }];
  const r = computePortfolio(txs, market, { base: 'PLN', today: '2024-03-01', estimateWithholding: false });
  assert.equal(r.dividends.length, 1);
  assert.ok(r.dividends[0].estimated);
  close(r.totals.dividends, 5);
  close(r.totals.profit, 5);
  // default: typical withholding for the issuer country (bare ticker -> US, 15%)
  const w = computePortfolio(txs, market, { base: 'PLN', today: '2024-03-01' });
  close(w.totals.dividends, 4.25);
  close(w.dividends[0].tax, 0.75);
  const off = computePortfolio(txs, market, { base: 'PLN', today: '2024-03-01', autoDividends: false });
  assert.equal(off.dividends.length, 0);
  // recorded dividends suppress estimates for that ticker
  const rec = computePortfolio([...txs, { portfolioId: 'p', date: '2024-02-10', type: 'DIVIDEND', ticker: 'AAA', amount: 5, tax: 0.95, currency: 'PLN' }], market, { base: 'PLN', today: '2024-03-01' });
  assert.equal(rec.dividends.length, 1);
  close(rec.totals.dividends, 4.05);
  // a recorded dividend far from the ex-date does not suppress the estimate
  const far = computePortfolio([...txs, { portfolioId: 'p', date: '2024-01-03', type: 'DIVIDEND', ticker: 'AAA', amount: 1, currency: 'PLN' }], market, { base: 'PLN', today: '2024-03-01' });
  assert.equal(far.dividends.length, 2);
});

test('xirr: 10% over one year', () => {
  close(xirr([['2023-01-01', -100], ['2024-01-01', 110]]), 0.1, 1e-3);
  assert.equal(xirr([['2023-01-01', -100]]), null);
});

test('periodStats profit excludes contributions', () => {
  const s = { dates: ['a', 'b', 'c'], value: [100, 210, 220], invested: [100, 200, 200], twr: [1, 1.1, 1.15] };
  const p = periodStats(s, 'b');
  close(p.profit, 10);
  close(p.twr, 1.15 / 1.1 - 1);
});

test('benchmark simulation buys benchmark with the same flows', () => {
  const market = new Market({ histories: { B: { currency: 'PLN', dates: ['2024-01-01', '2024-01-02'], close: [10, 20] } } });
  const series = { dates: ['2024-01-01', '2024-01-02'], flow: [100, 0] };
  const b = benchmarkSeries(series, market, 'B', 'PLN');
  assert.deepEqual(b.simulated, [100, 200]);
  assert.deepEqual(b.index, [1, 2]);
});

test('Polish tax: NBP D-1 rates, FIFO, foreign dividend top-up', () => {
  const market = new Market({
    nbp: { USD: { dates: ['2024-03-01', '2024-06-03', '2024-06-28'], rates: [4.0, 4.2, 4.1] } },
  });
  const t = computePolishTax([
    { portfolioId: 'p', date: '2024-03-04', type: 'BUY', ticker: 'X', quantity: 10, price: 100, fee: 1, currency: 'USD' },
    { portfolioId: 'p', date: '2024-06-04', type: 'SELL', ticker: 'X', quantity: 10, price: 120, fee: 1, currency: 'USD' },
    { portfolioId: 'p', date: '2024-07-01', type: 'DIVIDEND', ticker: 'X', amount: 10, tax: 1.5, currency: 'USD' },
    { portfolioId: 'p', date: '2024-07-01', type: 'DIVIDEND', ticker: 'PL', amount: 100, tax: 19, currency: 'PLN' },
  ], market);
  const y = t.years[0];
  close(y.proceeds, 1200 * 4.2);
  close(y.costs, 1001 * 4.0 + 1 * 4.2);
  close(y.income, 5040 - 4008.2);
  assert.equal(y.tax, Math.round(Math.round(1031.8) * 0.19));
  // dividend: 41 PLN gross, 19% = 7.79, withheld 6.15 -> 1.64 to pay; PLN dividend excluded
  close(y.divGross, 41);
  close(y.divToPay, 41 * 0.19 - 1.5 * 4.1);
  assert.equal(y.dividends.length, 2);
});

test('forecast uses trailing 12 months shifted one year', () => {
  const market = new Market({ histories: { A: { currency: 'PLN', dates: ['2024-06-01'], close: [10], dividends: [['2023-06-01', 1], ['2024-03-01', 0.5]] } } });
  const f = forecastDividends([{ ticker: 'A', qty: 10, currency: 'PLN' }], market, 'PLN', '2024-06-01');
  assert.equal(f.length, 1);
  assert.equal(f[0].date, '2025-03-01');
  close(f[0].amountBase, 5);
});

test('groupBy weights', () => {
  const g = groupBy([{ value: 30, s: 'a' }, { value: 10, s: 'b' }, { value: 60, s: 'a' }], (h) => h.s);
  assert.equal(g[0].label, 'a');
  close(g[0].weight, 0.9);
});

test('settlement currency: PLN account buying USD shares', () => {
  const market = new Market({
    histories: { US: { currency: 'USD', ...daily('2024-01-01', '2024-01-10', () => 11), dividends: [], splits: [] } },
    fx: { PLN: (({ dates, close }) => ({ dates, usd: close }))(daily('2024-01-01', '2024-01-10', () => 0.25)) },
  });
  const txs = [
    { portfolioId: 'p', date: '2024-01-01', type: 'DEPOSIT', amount: 1000, currency: 'PLN' },
    // 10 USD share, market FX 4.00 but broker charged 4.05 -> 40.50 PLN
    { portfolioId: 'p', date: '2024-01-02', type: 'BUY', ticker: 'US', quantity: 1, price: 10, currency: 'USD', settleAmount: 40.5, settleCurrency: 'PLN' },
    { portfolioId: 'p', date: '2024-01-05', type: 'DIVIDEND', ticker: 'US', amount: 1, tax: 0.15, currency: 'USD', settleAmount: 3.3, settleCurrency: 'PLN' },
  ];
  const r = computePortfolio(txs, market, { base: 'PLN', today: '2024-01-10' });
  close(r.holdings[0].costBase, 40.5);
  assert.deepEqual(Object.keys(r.cash), ['PLN']);
  close(r.cash.PLN, 1000 - 40.5 + 3.3);
  close(r.totals.dividends, 3.3);
  close(r.totals.value, 1000 - 40.5 + 3.3 + 44);
  // sell back at 11 USD, broker pays 43.5 PLN
  const r2 = computePortfolio([...txs, { portfolioId: 'p', date: '2024-01-08', type: 'SELL', ticker: 'US', quantity: 1, price: 11, currency: 'USD', settleAmount: 43.5, settleCurrency: 'PLN' }], market, { base: 'PLN', today: '2024-01-10' });
  close(r2.totals.realized, 3);
  close(r2.cash.PLN, 1000 - 40.5 + 3.3 + 43.5);
});

test('IKE contributions by year: deposits or net purchases', async () => {
  const { contributionsByYear } = await import('../docs/js/engine.js');
  const market = new Market({ fx: { PLN: { dates: ['2024-01-01'], usd: [0.25] } } });
  const dep = contributionsByYear([
    { portfolioId: 'ike', date: '2024-02-01', type: 'DEPOSIT', amount: 10000, currency: 'PLN' },
    { portfolioId: 'ike', date: '2024-03-01', type: 'BUY', ticker: 'X', quantity: 1, price: 100, currency: 'USD' },
    { portfolioId: 'other', date: '2024-03-01', type: 'DEPOSIT', amount: 5, currency: 'PLN' },
  ], 'ike', market);
  assert.equal(dep.method, 'deposits');
  assert.deepEqual(dep.byYear, { 2024: 10000 });
  const net = contributionsByYear([
    { portfolioId: 'ike', date: '2024-03-01', type: 'BUY', ticker: 'X', quantity: 1, price: 100, fee: 1, currency: 'USD' },
    { portfolioId: 'ike', date: '2025-03-01', type: 'BUY', ticker: 'Y', quantity: 10, price: 50, currency: 'PLN' },
    { portfolioId: 'ike', date: '2025-04-01', type: 'SELL', ticker: 'X', quantity: 1, price: 300, currency: 'PLN', settleAmount: 1200, settleCurrency: 'PLN' },
  ], 'ike', market);
  assert.equal(net.method, 'net purchases');
  close(net.byYear[2024], 404);
  assert.equal(net.byYear[2025], 0); // sells larger than buys -> floored at 0
});

test('loss carry-forward: 50% per year or one-off up to 5M within 5 years', async () => {
  const { applyLossCarryForward } = await import('../docs/js/engine.js');
  // small loss: one-off lets the whole 1000 go against 2024 income
  let ys = [{ year: '2023', income: -1000 }, { year: '2024', income: 3000 }];
  let left = applyLossCarryForward(ys);
  assert.equal(ys[1].lossDeducted, 1000);
  assert.equal(left[0].remaining, 0);
  // after a one-off, later years are capped at 50% of the original loss
  ys = [{ year: '2020', income: -10000 }, { year: '2021', income: 6000 }, { year: '2022', income: 10000 }];
  applyLossCarryForward(ys);
  assert.equal(ys[1].lossDeducted, 6000); // one-off
  assert.equal(ys[2].lossDeducted, 4000); // remaining, within the 50% (5000) cap
  // expiry after 5 years and prior losses from settings
  ys = [{ year: '2026', income: 500 }, { year: '2027', income: 500 }];
  applyLossCarryForward(ys, { 2021: 800 });
  assert.equal(ys[0].lossDeducted, 500);
  assert.equal(ys[1].lossDeducted, 0); // 2021 loss expired after 2026
});

test('Polish tax: carry-forward reduces the base, T+2 settlement rate, country breakdown', () => {
  const market = new Market({
    quotes: { X: { country: 'United States' } },
    nbp: { USD: { dates: ['2023-03-01', '2023-06-01', '2024-03-01', '2024-03-05', '2024-06-03', '2024-06-05'], rates: [4, 4, 4, 4.5, 4, 4.4] } },
  });
  const txs = [
    { portfolioId: 'p', date: '2023-03-02', type: 'BUY', ticker: 'X', quantity: 10, price: 100, currency: 'USD' },
    { portfolioId: 'p', date: '2023-06-02', type: 'SELL', ticker: 'X', quantity: 10, price: 90, currency: 'USD' }, // -400 PLN
    { portfolioId: 'p', date: '2024-03-04', type: 'BUY', ticker: 'X', quantity: 10, price: 100, currency: 'USD' }, // Mon
    { portfolioId: 'p', date: '2024-06-04', type: 'SELL', ticker: 'X', quantity: 10, price: 120, currency: 'USD' }, // Tue
  ];
  const t = computePolishTax(txs, market);
  const y24 = t.years.find((y) => y.year === '2024');
  close(y24.income, 800); // 4800 - 4000 at trade-date rates
  assert.equal(y24.lossDeducted, 400);
  assert.equal(y24.taxBase, 400);
  assert.equal(y24.countries[0].country, 'US');
  // settlement: buy settles Wed 2024-03-06 (rate of 03-05 = 4.5), sell settles Thu 06-06 (rate of 06-05 = 4.4)
  const s = computePolishTax(txs, market, { dateMode: 'settlement', carryForward: false });
  close(s.years.find((y) => y.year === '2024').income, 1200 * 4.4 - 1000 * 4.5);
});

test('rebalancePlan: buy-only splits new cash by deficit, full mode sells', async () => {
  const { rebalancePlan } = await import('../docs/js/engine.js');
  const rows = [{ key: 'A', value: 700, unitPrice: 10 }, { key: 'B', value: 300, unitPrice: 30 }];
  const buy = rebalancePlan(rows, { A: 50, B: 50 }, { cash: 400, mode: 'buy' });
  const b = Object.fromEntries(buy.items.map((i) => [i.key, i]));
  // total 1400 -> targets 700/700: B needs 400, A nothing
  assert.equal(b.A.shares, 0);
  assert.equal(b.B.shares, 13); // 13 * 30 = 390, 10 left
  close(buy.cashLeft, 10);
  close(b.A.drift, 0.2);
  const full = rebalancePlan(rows, { A: 50, B: 50 }, { mode: 'full' });
  const f = Object.fromEntries(full.items.map((i) => [i.key, i]));
  assert.equal(f.A.shares, -20);
  assert.equal(f.B.shares, 6);
  close(f.A.after, 0.5, 0.02);
  // new asset with a target, holdings without a target are ignored
  const n = rebalancePlan([...rows, { key: 'C', value: 1000, unitPrice: 5 }], { A: 40, B: 40, D: 20 }, { cash: 1000, mode: 'buy', wholeShares: false });
  assert.equal(n.items.find((i) => i.key === 'C'), undefined);
  close(n.items.find((i) => i.key === 'D').amount, 400);
});

test('tradeStats: win rate, profit factor, by year', async () => {
  const { tradeStats } = await import('../docs/js/engine.js');
  const s = tradeStats([
    { date: '2024-01-05', ticker: 'A', gain: 100, costBase: 1000, holdingDays: 10 },
    { date: '2024-02-05', ticker: 'B', gain: -50, costBase: 500, holdingDays: 30 },
    { date: '2025-03-05', ticker: 'C', gain: 300, costBase: 1000, holdingDays: 400 },
  ]);
  assert.equal(s.count, 3);
  close(s.winRate, 2 / 3);
  close(s.profitFactor, 8);
  close(s.avgWinPct, 0.2);
  close(s.avgLossPct, -0.1);
  close(s.avgHoldingDays, 440 / 3);
  assert.equal(s.best.ticker, 'C'); assert.equal(s.worst.ticker, 'B');
  assert.deepEqual(s.byYear.map((y) => [y.year, y.trades, y.gain]), [['2025', 1, 300], ['2024', 2, 50]]);
  assert.equal(tradeStats([]).winRate, null);
});

test('dividendGrowth: annual sums, CAGR over full years, growth streak', async () => {
  const { dividendGrowth } = await import('../docs/js/engine.js');
  const g = dividendGrowth([['2020-03-01', 1], ['2020-09-01', 1], ['2021-03-01', 2.2], ['2022-03-01', 2.4], ['2023-03-01', 2.6], ['2024-03-01', 2.5], ['2025-03-01', 3]], '2025-06-01');
  assert.deepEqual(g.annual.map((a) => a.dps), [2, 2.2, 2.4, 2.6, 2.5, 3]);
  assert.ok(g.annual.at(-1).partial);
  close(g.cagr1, 2.5 / 2.6 - 1);
  close(g.cagr3, Math.pow(2.5 / 2.2, 1 / 3) - 1);
  assert.equal(g.cagr5, null); // needs 6 full years
  assert.equal(g.streak, 0);   // 2024 was a cut
  assert.equal(dividendGrowth([['2022-01-01', 1], ['2023-01-01', 2], ['2024-01-01', 3]], '2025-01-02').streak, 2);
});

test('CONVERSION moves cash between currencies without being a flow', () => {
  const market = new Market({ fx: { PLN: { dates: ['2024-01-01'], usd: [0.25] } } });
  const r = computePortfolio([
    { portfolioId: 'p', date: '2024-01-01', type: 'DEPOSIT', amount: 4000, currency: 'PLN' },
    { portfolioId: 'p', date: '2024-01-02', type: 'CONVERSION', amount: 4000, currency: 'PLN', toAmount: 990, toCurrency: 'USD' },
  ], market, { base: 'PLN', today: '2024-01-03' });
  assert.deepEqual(r.cash, { USD: 990 });
  close(r.totals.invested, 4000);
  close(r.totals.value, 3960);   // 990 USD × 4 PLN
  close(r.totals.profit, -40);   // the spread
});

test('taxReportCSV lists sales, dividends and totals', async () => {
  const { taxReportCSV } = await import('../docs/js/engine.js');
  const csv = taxReportCSV({ year: '2024', proceeds: 1200, costs: 1000, income: 200, divGross: 10, divWithheld: 1.5, divToPay: 0.4, divToPayRounded: 0, taxBase: 200, tax: 38, lossDeducted: 0,
    trades: [{ date: '2024-05-01', ticker: 'X', qty: 1, currency: 'USD', rate: 4, proceeds: 1200, costs: 1000, income: 200, buys: [{ qty: 1, price: 250, date: '2024-01-01', rate: 4 }] }],
    dividends: [{ date: '2024-06-01', ticker: 'X', currency: 'USD', rate: 4, gross: 10, withheld: 1.5, toPay: 0.4, domestic: false }] });
  const lines = csv.split('\n');
  assert.equal(lines.length, 7);
  assert.match(lines[1], /^sale,2024-05-01,X,1,USD,4,1200\.00,1000\.00,200\.00/);
  assert.match(lines[2], /^dividend,2024-06-01,X/);
  assert.match(lines[6], /^tax_19pct,.*,38,,,0,$/);
});

test('riskStats: drawdown, annualised return', async () => {
  const { riskStats } = await import('../docs/js/engine.js');
  const dates = [], twr = [];
  for (let i = 0; i <= 730; i++) { dates.push(addDays('2022-01-01', i)); twr.push(i < 100 ? 1 + i / 100 : i < 200 ? 2 - (i - 100) / 200 : 1.5 + (i - 200) / 1000); }
  const r = riskStats({ dates, twr });
  close(r.mdd, -0.25); // peak 2.0 (day 100), trough 1.5 (day 200)
  close(r.cagr, Math.pow(twr.at(-1), 1 / r.years) - 1);
  assert.ok(r.vol > 0);
  assert.equal(riskStats({ dates: [], twr: [] }).cagr, null);
});
