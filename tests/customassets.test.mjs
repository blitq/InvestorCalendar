import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customTicker, customValueOn, customHistory, isCustomTicker } from '../docs/js/customassets.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('custom tickers are slugs and unique', () => {
  assert.equal(customTicker('Mieszkanie Kraków'), 'X:MIESZKANIE-KRAKOW');
  assert.equal(customTicker('Flat', { 'X:FLAT': {} }), 'X:FLAT-2');
  assert.ok(isCustomTicker('X:FLAT') && !isCustomTicker('AAPL'));
});

test('valuations hold flat; a rate compounds from the last valuation', () => {
  const flat = { valuations: [['2024-01-01', 500000], ['2025-01-01', 560000]] };
  assert.equal(customValueOn(flat, '2023-12-31'), null);
  assert.equal(customValueOn(flat, '2024-06-01'), 500000);
  assert.equal(customValueOn(flat, '2025-03-01'), 560000);
  const dep = { valuations: [['2024-01-01', 10000]], rate: 5 };
  close(customValueOn(dep, '2024-12-31'), 10000 * 1.05 ** (365 / 365));
  const h = customHistory({ ...dep, currency: 'PLN' }, '2024-01-10');
  assert.equal(h.dates.length, 10);
  assert.equal(h.close[0], 10000);
});
