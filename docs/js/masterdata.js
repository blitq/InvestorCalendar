// Data preparation for the master chart. Pure functions (no DOM) so they can be unit-tested.
import { xirr, benchmarkSeries } from './engine.js';

const DAY = 864e5;
const dayNum = (d) => Date.parse(d + 'T00:00:00Z') / DAY;

/** Bucket id for a date: day, ISO week (Monday start) or month. */
export function bucketKey(d, gran) {
  if (gran === 'M') return d.slice(0, 7);
  if (gran === 'W') return Math.floor((dayNum(d) + 3) / 7); // 1970-01-01 was a Thursday
  return d;
}

/** Daily up to ~13 months, weekly up to ~5 years, monthly beyond. */
export function autoGranularity(nDays) {
  return nDays <= 400 ? 'D' : nDays <= 1900 ? 'W' : 'M';
}

/** Indices s..e reduced to the last day of each bucket (always keeping s and e). */
export function sampleIndices(dates, s, e, gran) {
  const out = [];
  if (e < s) return out;
  if (gran === 'D') { for (let i = s; i <= e; i++) out.push(i); return out; }
  for (let i = s; i <= e; i++) {
    if (i === e || bucketKey(dates[i], gran) !== bucketKey(dates[i + 1], gran)) out.push(i);
  }
  if (out[0] !== s) out.unshift(s);
  return out;
}

function firstIdxGte(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * Build everything the master chart can plot for the window [from, to].
 * series: computePortfolio().series   opts: {
 *   from, to, gran ('auto'|'D'|'W'|'M'), market, base, benchmarks: [ticker],
 *   withMwr, dividends: [{date, netBase, ticker, estimated}], transactions, events: [{date, ticker, type, title}],
 *   maxMwrPoints }
 */
export function buildMasterData(series, opts = {}) {
  const { dates, value, invested, twr, flow } = series;
  const empty = { labels: [], gran: 'D', idx: [] };
  if (!dates.length) return empty;
  let s = opts.from ? firstIdxGte(dates, opts.from) : 0;
  let e = opts.to ? firstIdxGte(dates, opts.to) : dates.length - 1;
  if (e >= dates.length || (opts.to && dates[e] > opts.to)) e -= 1;
  s = Math.max(0, Math.min(s, dates.length - 1));
  e = Math.max(s, Math.min(e, dates.length - 1));
  const gran = !opts.gran || opts.gran === 'auto' ? autoGranularity(e - s + 1) : opts.gran;
  const idx = sampleIndices(dates, s, e, gran);
  const labels = idx.map((i) => dates[i]);
  const pick = (arr) => idx.map((i) => arr[i]);

  const out = { gran, idx, labels, from: dates[s], to: dates[e] };
  // Window starting on day one: nothing existed "before" it, so the start value is 0 and
  // that day's inflows count as flows. Otherwise the start value is the first day's close.
  const atStart = s === 0;
  const startV = atStart ? 0 : value[s];
  out.value = pick(value);
  out.invested = pick(invested);
  const p0 = atStart ? 0 : value[s] - invested[s];
  out.profit = idx.map((i) => value[i] - invested[i] - p0);
  const t0 = atStart ? 1 : twr[s];
  out.twr = idx.map((i) => (t0 ? (twr[i] / t0 - 1) * 100 : null));
  out.simple = idx.map((i) => (invested[i] > 1e-9 ? ((value[i] - invested[i]) / invested[i]) * 100 : null));

  // drawdown of the TWR index, peak measured inside the window, using every day (not just samples)
  const ddByIdx = new Map();
  let peak = -Infinity;
  for (let i = s; i <= e; i++) { peak = Math.max(peak, twr[i]); ddByIdx.set(i, peak > 0 ? (twr[i] / peak - 1) * 100 : 0); }
  out.drawdown = idx.map((i) => ddByIdx.get(i));

  // money-weighted return (XIRR, annualised) from the window start to each sample
  out.mwr = idx.map(() => null);
  if (opts.withMwr) {
    const step = Math.max(1, Math.ceil(idx.length / (opts.maxMwrPoints || 200)));
    const flows = startV > 1e-9 ? [[dates[s], -startV]] : [];
    let k = 0;
    for (let i = s; i <= e; i++) {
      if ((i > s || atStart) && flow[i]) flows.push([dates[i], -flow[i]]);
      if (i === idx[k]) {
        if ((k % step === 0 || k === idx.length - 1) && dayNum(dates[i]) - dayNum(dates[s]) >= 90) { // annualising shorter spans is mostly noise
          const r = xirr([...flows, [dates[i], value[i]]]);
          out.mwr[k] = r === null ? null : r * 100;
        }
        k++;
      }
    }
  }

  // bars (dividends / net flows): per bucket, placed on the bucket's last sample
  const barGran = gran === 'D' ? 'M' : gran;
  const keyOfSample = labels.map((d) => bucketKey(d, barGran));
  const lastPos = new Map();
  keyOfSample.forEach((key, k) => lastPos.set(key, k));
  out.flowBars = labels.map(() => null);
  out.dividendBars = labels.map(() => null);
  const addBar = (arr, d, v) => {
    const k = lastPos.get(bucketKey(d, barGran));
    if (k !== undefined && v) arr[k] = (arr[k] || 0) + v;
  };
  for (let i = s; i <= e; i++) addBar(out.flowBars, dates[i], flow[i]);
  for (const d of opts.dividends || []) if (d.date >= out.from && d.date <= out.to) addBar(out.dividendBars, d.date, d.netBase);
  out.barGran = barGran;

  // benchmarks: % change from window start, and "same money" simulated value
  out.benches = {};
  for (const t of opts.benchmarks || []) {
    if (!opts.market) break;
    const b = benchmarkSeries(series, opts.market, t, opts.base);
    let b0 = null;
    for (let i = s; i <= e && b0 === null; i++) b0 = b.index[i];
    out.benches[t] = {
      pct: idx.map((i) => (b.index[i] !== null && b0 ? (b.index[i] / b0 - 1) * 100 : null)),
      money: idx.map((i) => b.simulated[i]),
    };
  }

  // markers: grouped onto the sample whose period contains the date
  const pos = (d) => { const k = firstIdxGte(labels, d); return k < labels.length ? k : -1; };
  const group = (items) => {
    const m = new Map();
    for (const it of items) {
      if (it.date < out.from || it.date > out.to) continue;
      const k = pos(it.date);
      if (k < 0) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  };
  const txs = opts.transactions || [];
  out.markers = {
    buys: group(txs.filter((t) => t.type === 'BUY')),
    sells: group(txs.filter((t) => t.type === 'SELL')),
    dividends: group(opts.dividends || []),
    events: group(opts.events || []),
  };

  // summary for the window
  const fl = startV > 1e-9 ? [[dates[s], -startV]] : [];
  let netFlows = 0;
  for (let i = atStart ? s : s + 1; i <= e; i++) { netFlows += flow[i]; if (flow[i]) fl.push([dates[i], -flow[i]]); }
  out.summary = {
    startValue: startV, endValue: value[e],
    profit: value[e] - invested[e] - p0,
    twr: atStart ? twr[e] - 1 : (twr[s] ? twr[e] / twr[s] - 1 : null),
    mwr: xirr([...fl, [dates[e], value[e]]]),
    netFlows,
    dividends: (opts.dividends || []).filter((d) => d.date >= out.from && d.date <= out.to).reduce((a, d) => a + d.netBase, 0),
    maxDrawdown: Math.min(0, ...out.drawdown) / 100,
  };
  return out;
}
