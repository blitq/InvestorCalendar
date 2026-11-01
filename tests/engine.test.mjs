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
  const r = computePortfolio(txs, market, { base: 'PLN', today: '2024-03-01' });
  assert.equal(r.dividends.length, 1);
  assert.ok(r.dividends[0].estimated);
  close(r.totals.dividends, 5);
  close(r.totals.profit, 5);
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
