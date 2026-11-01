import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, parseSeries, seriesCode, bondTicker, isBondTicker, schedule, valueOn, bondHistory, redemption } from '../docs/js/bonds.js';
import { Market, computePortfolio } from '../docs/js/engine.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const CPI = { months: ['2024-01', '2025-01', '2026-01'], yoy: [3.7, 4.9, 2.5] };

test('series codes and months', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(seriesCode('EDO', '2025-03-14'), 'EDO0335');
  assert.equal(bondTicker('COI', '2024-03-05'), 'COI0328#05');
  assert.ok(isBondTicker('EDO0335#14') && !isBondTicker('AAPL'));
  assert.deepEqual(parseSeries('EDO0335'), { type: 'EDO', maturity: '2035-03' });
});

test('EDO: first-year fixed, then CPI (2 months before) + margin, capitalised', () => {
  const bond = { type: 'EDO', purchaseDate: '2024-03-15', firstRate: 6.8, margin: 2 };
  const s = schedule(bond, CPI);
  assert.equal(s.length, 10);
  assert.equal(s[1].cpiMonth, '2025-01');
  close(s[1].rate, 6.9);
  assert.equal(s[2].source, 'CPI 2026-01');
  assert.match(s[3].source, /estimate \(CPI 2026-01\)/); // later months fall back to the latest CPI
  close(valueOn(bond, s, '2025-03-15').value, 106.8);
  const half = valueOn(bond, s, '2025-09-15'); // 184 of 365 days into year 2
  close(half.value, 106.8 * (1 + 0.069 * 184 / 365));
  // overrides win
  close(schedule({ ...bond, overrides: { 1: 7.5 } }, CPI)[1].rate, 7.5);
});

test('COI pays interest yearly; redemption fee capped and taxed', () => {
  const bond = { type: 'COI', purchaseDate: '2024-01-10', firstRate: 7, margin: 1.25, fee: 0.7 };
  const s = schedule(bond, CPI);
  const v = valueOn(bond, s, '2025-02-10');
  assert.equal(v.payouts.length, 1);
  close(v.payouts[0][1], 7);
  assert.ok(v.value < 101); // capital back to 100 + small accrual
  const r = redemption(bond, s, '2024-01-20');
  assert.ok(r.fee <= r.gross - 100 + 1e-9); // fee never eats capital
  const r2 = redemption(bond, s, '2025-01-20', { taxFree: true });
  assert.equal(r2.tax, 0);
});

test('bond history plugs into the portfolio engine', () => {
  const bond = { ticker: 'EDO0334#15', type: 'EDO', purchaseDate: '2024-03-15', firstRate: 6.8, margin: 2 };
  const h = bondHistory(bond, CPI, '2025-03-15');
  const market = new Market({ histories: { [bond.ticker]: h }, quotes: { [bond.ticker]: { currency: 'PLN', country: 'Poland' } } });
  const r = computePortfolio([{ portfolioId: 'p', date: '2024-03-15', type: 'BUY', ticker: bond.ticker, quantity: 10, price: 100, currency: 'PLN' }], market, { base: 'PLN', today: '2025-03-15' });
  close(r.totals.value, 1068);
  close(r.totals.profit, 68);
});
