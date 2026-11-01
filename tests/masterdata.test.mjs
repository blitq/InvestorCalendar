import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketKey, autoGranularity, sampleIndices, buildMasterData } from '../docs/js/masterdata.js';
import { addDays } from '../docs/js/engine.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

function mkSeries(start, n, fn) {
  const s = { dates: [], value: [], invested: [], twr: [], flow: [] };
  for (let i = 0; i < n; i++) {
    const r = fn(i);
    s.dates.push(addDays(start, i)); s.value.push(r.value); s.invested.push(r.invested); s.twr.push(r.twr); s.flow.push(r.flow || 0);
  }
  return s;
}

test('bucketKey weeks start on Monday', () => {
  assert.equal(bucketKey('2024-01-07', 'W') === bucketKey('2024-01-08', 'W'), false); // Sun vs Mon
  assert.equal(bucketKey('2024-01-08', 'W'), bucketKey('2024-01-14', 'W'));          // Mon..Sun
  assert.equal(bucketKey('2024-01-31', 'M'), '2024-01');
});

test('autoGranularity', () => {
  assert.equal(autoGranularity(300), 'D');
  assert.equal(autoGranularity(1000), 'W');
  assert.equal(autoGranularity(4000), 'M');
});

test('sampleIndices keeps window start and bucket ends', () => {
  const dates = []; for (let i = 0; i < 70; i++) dates.push(addDays('2024-01-10', i)); // Jan 10 .. Mar 19
  const m = sampleIndices(dates, 0, 69, 'M').map((i) => dates[i]);
  assert.deepEqual(m, ['2024-01-10', '2024-01-31', '2024-02-29', '2024-03-19']);
  assert.equal(sampleIndices(dates, 5, 9, 'D').length, 5);
});

test('window rebasing: profit and TWR start at zero mid-history', () => {
  // value grows 1%/day, one inflow of 100 on day 0
  const s = mkSeries('2024-01-01', 60, (i) => ({ value: 100 * 1.01 ** i, invested: 100, twr: 1.01 ** i, flow: i === 0 ? 100 : 0 }));
  const d = buildMasterData(s, { from: '2024-01-11', gran: 'D' });
  close(d.profit[0], 0);
  close(d.twr[0], 0);
  close(d.twr[d.twr.length - 1], (1.01 ** 49 - 1) * 100);
  close(d.summary.twr, 1.01 ** 49 - 1);
  // whole history: profit counts from zero, not from day-one close
  const all = buildMasterData(s, { gran: 'D' });
  close(all.summary.profit, 100 * 1.01 ** 59 - 100);
  close(all.summary.netFlows, 100);
});

test('drawdown uses every day, not just samples', () => {
  const twr = [1, 1.2, 0.9, 1.0, 1.1];
  const s = mkSeries('2024-01-01', 5, (i) => ({ value: twr[i] * 100, invested: 100, twr: twr[i] }));
  const d = buildMasterData(s, { gran: 'D' });
  close(d.drawdown[2], (0.9 / 1.2 - 1) * 100);
  close(d.summary.maxDrawdown, 0.9 / 1.2 - 1);
});

test('MWR at the end matches a plain 10%-a-year growth', () => {
  const n = 366;
  const s = mkSeries('2023-01-01', n, (i) => ({ value: 100 * 1.1 ** (i / 365), invested: 100, twr: 1.1 ** (i / 365), flow: i === 0 ? 100 : 0 }));
  const d = buildMasterData(s, { gran: 'W', withMwr: true });
  close(d.mwr[d.mwr.length - 1], 10, 0.05);
  assert.equal(d.mwr[0], null); // < 90 days
  assert.equal(d.mwr[8], null);  // week 8 is still < 90 days
  close(d.summary.mwr, 0.1, 5e-4);
});

test('bars aggregate per month for daily view; markers land in their period', () => {
  const s = mkSeries('2024-01-01', 60, (i) => ({ value: 100, invested: 100, twr: 1, flow: i === 0 ? 100 : i === 40 ? 50 : 0 }));
  const d = buildMasterData(s, {
    gran: 'W',
    dividends: [{ date: '2024-01-15', netBase: 5 }, { date: '2024-01-16', netBase: 2 }],
    transactions: [{ date: '2024-01-03', type: 'BUY', ticker: 'X' }, { date: '2024-02-10', type: 'SELL', ticker: 'X' }],
  });
  assert.equal(d.barGran, 'W');
  assert.equal(d.dividendBars.filter((v) => v).length, 1);
  close(d.dividendBars.find((v) => v), 7);
  assert.equal(d.flowBars.reduce((a, v) => a + (v || 0), 0), 150);
  const [[k, items]] = [...d.markers.buys];
  assert.ok(d.labels[k] >= '2024-01-03' && (k === 0 || d.labels[k - 1] < '2024-01-03'));
  assert.equal(items.length, 1);
  assert.equal(d.markers.sells.size, 1);
});
