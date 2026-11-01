// Portfolio engine: pure functions, no DOM. Runs in the browser and in Node tests.
//
// Transaction shape (all amounts in `currency`, dates 'YYYY-MM-DD'):
//   { id, portfolioId, date, type, ticker?, quantity?, price?, fee?, amount?, tax?, currency, note? }
//   BUY / SELL           quantity, price, fee
//   DIVIDEND             ticker, amount (gross), tax (withheld at source)
//   DEPOSIT / WITHDRAWAL amount             -> switches the portfolio into "cash mode"
//   FEE / INTEREST / TAX amount
//   optional on BUY/SELL/DIVIDEND: settleAmount + settleCurrency = cash actually moved in the
//   account currency (e.g. PLN paid for USD shares, incl. fees and FX spread)
//
// Cash mode: when a portfolio has deposits/withdrawals, its cash balances are part of
// its value and deposits/withdrawals are the external flows. Otherwise every buy is
// treated as fresh money in and every sell / dividend as money taken out.

export const TX_TYPES = ['BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'INTEREST', 'TAX'];
const TYPE_ORDER = { DEPOSIT: 0, INTEREST: 1, BUY: 2, SELL: 3, DIVIDEND: 4, FEE: 5, TAX: 6, WITHDRAWAL: 7 };
export const PL_TAX_RATE = 0.19;
const EPS = 1e-9;

// ---------------------------------------------------------------- dates

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addYears(iso, n) {
  return (parseInt(iso.slice(0, 4), 10) + n) + iso.slice(4);
}

function yearFrac(a, b) {
  return (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / (365.25 * 86400000);
}

// ---------------------------------------------------------------- series

export class Series {
  constructor(dates = [], values = []) {
    this.dates = [];
    this.values = [];
    for (let i = 0; i < dates.length; i++) {
      if (values[i] !== null && values[i] !== undefined && !Number.isNaN(values[i])) {
        this.dates.push(dates[i]);
        this.values.push(values[i]);
      }
    }
  }
  get length() { return this.dates.length; }
  /** index of the last date <= d, or -1 */
  idx(d) {
    let lo = 0, hi = this.dates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  at(d) { const i = this.idx(d); return i < 0 ? null : this.values[i]; }
  /** last value strictly before d */
  before(d) { const i = this.idx(addDays(d, -1)); return i < 0 ? null : this.values[i]; }
  get lastDate() { return this.dates[this.dates.length - 1] ?? null; }
  get last() { return this.values[this.values.length - 1] ?? null; }
}

// ---------------------------------------------------------------- market data

export class Market {
  constructor({ quotes = {}, histories = {}, fx = {}, nbp = {}, manualPrices = {} } = {}) {
    this.quotes = quotes;
    this.histories = histories;
    this.manualPrices = manualPrices;
    this.prices = {};
    for (const [t, h] of Object.entries(histories)) this.prices[t] = new Series(h.dates, h.close);
    this.fx = {};
    for (const [c, f] of Object.entries(fx)) this.fx[c] = new Series(f.dates, f.usd);
    this.nbp = {};
    for (const [c, n] of Object.entries(nbp)) this.nbp[c] = new Series(n.dates, n.rates);
  }

  currency(t) {
    return this.quotes[t]?.currency || this.histories[t]?.currency || this.manualPrices[t]?.currency || null;
  }

  name(t) { return this.quotes[t]?.name || t; }

  /** close at or before d (split-unadjusted); falls back to a manual price */
  price(t, d) {
    const v = this.prices[t]?.at(d);
    if (v !== null && v !== undefined) return v;
    return this.manualPrices[t]?.price ?? null;
  }

  lastPrice(t) {
    const s = this.prices[t];
    if (s && s.length) return s.last;
    return this.manualPrices[t]?.price ?? null;
  }

  /** previous close for the latest bar, used for "today's change" */
  prevClose(t) {
    const s = this.prices[t];
    if (!s || s.length < 2) return null;
    return s.values[s.length - 2];
  }

  usd(c, d) {
    if (c === 'USD') return 1;
    const s = this.fx[c];
    if (!s || !s.length) return null;
    const v = s.at(d);
    return v ?? s.values[0];
  }

  /** units of `to` per one unit of `from` on date d */
  fxRate(from, to, d) {
    if (!from || !to || from === to) return 1;
    const a = this.usd(from, d), b = this.usd(to, d);
    if (a === null || b === null) return null;
    return a / b;
  }

  /** NBP mid rate (PLN per unit) from the last business day before d */
  nbpRate(c, d) {
    if (c === 'PLN') return 1;
    return this.nbp[c]?.before(d) ?? null;
  }

  splits(t) { return this.histories[t]?.splits || []; }
  dividends(t) { return this.histories[t]?.dividends || []; }
}

// ---------------------------------------------------------------- FIFO book

class FifoBook {
  constructor() { this.lots = new Map(); }
  _get(key) {
    if (!this.lots.has(key)) this.lots.set(key, []);
    return this.lots.get(key);
  }
  buy(key, lot) { this._get(key).push({ ...lot }); }
  qty(key) { return (this.lots.get(key) || []).reduce((s, l) => s + l.qty, 0); }
  /** consume `qty` FIFO, returns consumed slices (fee pro-rated) and any shortfall */
  sell(key, qty) {
    const lots = this._get(key);
    const used = [];
    let left = qty;
    while (left > EPS && lots.length) {
      const lot = lots[0];
      const take = Math.min(lot.qty, left);
      const share = take / lot.qty;
      used.push({ ...lot, qty: take, fee: lot.fee * share });
      lot.fee -= lot.fee * share;
      lot.qty -= take;
      left -= take;
      if (lot.qty <= EPS) lots.shift();
    }
    return { used, shortfall: left > EPS ? left : 0 };
  }
  split(matchTicker, ratio) {
    for (const [key, lots] of this.lots) {
      if (key.split('|')[1] !== matchTicker) continue;
      for (const l of lots) { l.qty *= ratio; l.price /= ratio; }
    }
  }
  keys() { return [...this.lots.keys()]; }
  get(key) { return this.lots.get(key) || []; }
}

function sortTransactions(txs) {
  return txs
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t && t.date && TX_TYPES.includes(t.type))
    .sort((a, b) => a.t.date.localeCompare(b.t.date)
      || (TYPE_ORDER[a.t.type] - TYPE_ORDER[b.t.type]) || a.i - b.i)
    .map(({ t }) => t);
}

const n = (v) => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? 0 : +v);

// ---------------------------------------------------------------- main computation

/**
 * Replays all transactions day by day and returns holdings, totals and a daily series.
 * opts: { base='PLN', today, autoDividends=true }
 */
export function computePortfolio(transactions, market, opts = {}) {
  const base = opts.base || 'PLN';
  const today = opts.today || todayISO();
  const autoDividends = opts.autoDividends !== false;
  const warnings = new Set();
  const txs = sortTransactions(transactions).filter((t) => t.date <= today);

  const result = {
    base, today, holdings: [], closed: [], cash: {}, trades: [], dividends: [],
    series: { dates: [], value: [], invested: [], twr: [], flow: [] },
    totals: emptyTotals(), warnings: [],
  };
  if (!txs.length) return result;

  const fx = (ccy, d) => {
    const r = market.fxRate(ccy, base, d);
    if (r === null) { warnings.add(`Missing FX rate ${ccy}→${base}; treated as 1.`); return 1; }
    return r;
  };

  const cashMode = {};
  const recordedDiv = new Map(); // pid|ticker -> sorted recorded dividend dates
  const byDate = new Map();
  const tickers = new Set();
  for (const t of txs) {
    if (t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL') cashMode[t.portfolioId] = true;
    if (t.type === 'DIVIDEND' && t.ticker) {
      const k = `${t.portfolioId}|${t.ticker}`;
      if (!recordedDiv.has(k)) recordedDiv.set(k, []);
      recordedDiv.get(k).push(t.date);
    }
    if (t.ticker) tickers.add(t.ticker);
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }

  const splitsOn = new Map();   // date -> [[ticker, ratio]]
  const divsOn = new Map();     // date -> [[ticker, dps]]
  for (const tk of tickers) {
    for (const [d, r] of market.splits(tk)) {
      if (!splitsOn.has(d)) splitsOn.set(d, []);
      splitsOn.get(d).push([tk, r]);
    }
    if (autoDividends) {
      for (const [d, dps] of market.dividends(tk)) {
        if (!divsOn.has(d)) divsOn.set(d, []);
        divsOn.get(d).push([tk, dps]);
      }
    }
  }

  const book = new FifoBook();
  const posInfo = new Map(); // key pid|ticker -> {pid, ticker, currency, realized, dividends, fees}
  const cash = new Map();    // pid|ccy -> amount
  const lastTxPrice = {};
  const totals = emptyTotals();

  const pos = (pid, ticker, ccy) => {
    const key = `${pid}|${ticker}`;
    if (!posInfo.has(key)) posInfo.set(key, { pid, ticker, currency: ccy, realized: 0, realizedLocal: 0, dividends: 0, fees: 0 });
    return posInfo.get(key);
  };
  const addCash = (pid, ccy, amt) => {
    const key = `${pid}|${ccy}`;
    cash.set(key, (cash.get(key) || 0) + amt);
  };

  let prevValue = 0, invested = 0, twrIndex = 1;
  const xirrFlows = [];

  for (let d = txs[0].date; d <= today; d = addDays(d, 1)) {
    let flowIn = 0, flowOut = 0; // base currency, investor money into (+) / out of (-) the portfolio

    // 1) splits effective today (prices are post-split from this date on)
    for (const [tk, ratio] of splitsOn.get(d) || []) {
      book.split(tk, ratio);
      if (lastTxPrice[tk]) lastTxPrice[tk] /= ratio;
    }

    // 2) dividends estimated from market data (ex-date today, entitlement = yesterday's holding)
    for (const [tk, dps] of divsOn.get(d) || []) {
      for (const key of book.keys()) {
        const [pid, ktk] = key.split('|');
        // skip the estimate when the user recorded this payment (paid ~0–60 days after the ex-date)
        if (ktk !== tk || (recordedDiv.get(key) || []).some((rd) => rd >= addDays(d, -10) && rd <= addDays(d, 60))) continue;
        const qty = book.qty(key);
        if (qty <= EPS) continue;
        const ccy = market.currency(tk) || posInfo.get(key)?.currency || base;
        const gross = qty * dps;
        const rate = fx(ccy, d);
        // typical treaty withholding for the issuer's country (tax-free accounts still pay foreign WHT)
        const wht = opts.estimateWithholding === false ? 0 : (WITHHOLDING[countryOf(market, tk)] ?? 0.15);
        const tax = gross * wht, net = gross - tax;
        result.dividends.push({ date: d, portfolioId: pid, ticker: tk, currency: ccy, gross, tax, net,
          grossBase: gross * rate, netBase: net * rate, estimated: true });
        pos(pid, tk, ccy).dividends += net * rate;
        totals.dividends += net * rate;
        totals.taxes += tax * rate;
        if (cashMode[pid]) addCash(pid, ccy, net); else flowOut -= net * rate;
      }
    }

    // 3) transactions
    for (const t of byDate.get(d) || []) {
      const pid = t.portfolioId;
      const cm = !!cashMode[pid];
      const ccy = t.currency || (t.ticker && market.currency(t.ticker)) || base;
      const rate = fx(ccy, d);
      // Settlement in another (account) currency, e.g. USD shares bought from a PLN account.
      // settleAmount is the total cash that moved (incl. fees and the broker's FX spread).
      const sccy = t.settleCurrency && t.settleCurrency !== ccy && n(t.settleAmount) > 0 ? t.settleCurrency : null;
      const sAmt = sccy ? n(t.settleAmount) : 0;
      const sBase = sccy ? sAmt * fx(sccy, d) : 0;
      switch (t.type) {
        case 'BUY': {
          const qty = n(t.quantity), price = n(t.price), fee = n(t.fee);
          if (qty <= 0) { warnings.add(`Ignored BUY ${t.ticker} on ${d} with no quantity.`); break; }
          const p = pos(pid, t.ticker, ccy);
          const cost = qty * price + fee;
          const eff = sccy && cost > EPS ? sBase / cost : rate; // base per unit of price currency actually paid
          book.buy(`${pid}|${t.ticker}`, { date: d, qty, price, fee, currency: ccy, rate: eff });
          p.fees += fee * eff; totals.fees += fee * eff;
          lastTxPrice[t.ticker] = price;
          const mc = market.currency(t.ticker);
          if (mc && mc !== ccy) warnings.add(`${t.ticker}: transactions in ${ccy} but market data is in ${mc}.`);
          if (cm) addCash(pid, sccy || ccy, -(sccy ? sAmt : cost)); else flowIn += sccy ? sBase : cost * rate;
          break;
        }
        case 'SELL': {
          const qty = n(t.quantity), price = n(t.price), fee = n(t.fee);
          const key = `${pid}|${t.ticker}`;
          const p = pos(pid, t.ticker, ccy);
          const { used, shortfall } = book.sell(key, qty);
          if (shortfall) warnings.add(`SELL ${t.ticker} on ${d}: ${fmtQty(shortfall)} more shares sold than held (ignored).`);
          const soldQty = qty - shortfall;
          if (soldQty <= EPS) break;
          const sellFee = fee * (soldQty / qty);
          const proceedsLocal = soldQty * price - sellFee;
          const costLocal = used.reduce((s, l) => s + l.qty * l.price + l.fee, 0);
          const costBase = used.reduce((s, l) => s + (l.qty * l.price + l.fee) * l.rate, 0);
          const grossLocal = qty * price - fee;
          const eff = sccy && grossLocal > EPS ? sBase / grossLocal : rate;
          const proceedsBase = proceedsLocal * eff;
          const gain = proceedsBase - costBase;
          p.realized += gain; p.realizedLocal += proceedsLocal - costLocal;
          p.fees += fee * eff; totals.fees += fee * eff;
          totals.realized += gain;
          lastTxPrice[t.ticker] = price;
          result.trades.push({ date: d, portfolioId: pid, ticker: t.ticker, qty: soldQty, price, currency: ccy,
            proceedsLocal, costLocal, proceedsBase, costBase, gain, holdingDays: used.length ? Math.round(yearFrac(used[0].date, d) * 365.25) : 0 });
          if (cm) addCash(pid, sccy || ccy, sccy ? sAmt : soldQty * price - fee);
          else flowOut -= sccy ? sBase : (soldQty * price - fee) * rate;
          break;
        }
        case 'DIVIDEND': {
          const gross = n(t.amount), tax = n(t.tax), net = gross - tax;
          const eff = sccy && net > EPS ? sBase / net : rate;
          result.dividends.push({ date: d, portfolioId: pid, ticker: t.ticker, currency: ccy, gross, tax, net,
            grossBase: gross * eff, netBase: net * eff, estimated: false });
          if (t.ticker) pos(pid, t.ticker, ccy).dividends += net * eff;
          totals.dividends += net * eff;
          totals.taxes += tax * eff;
          if (cm) addCash(pid, sccy || ccy, sccy ? sAmt : net); else flowOut -= sccy ? sBase : net * rate;
          break;
        }
        case 'DEPOSIT':
          addCash(pid, ccy, n(t.amount)); flowIn += n(t.amount) * rate; break;
        case 'WITHDRAWAL':
          addCash(pid, ccy, -n(t.amount)); flowOut -= n(t.amount) * rate; break;
        case 'INTEREST':
          totals.interest += n(t.amount) * rate;
          if (cm) addCash(pid, ccy, n(t.amount)); else flowOut -= n(t.amount) * rate;
          break;
        case 'FEE':
        case 'TAX':
          if (t.type === 'FEE') totals.fees += n(t.amount) * rate; else totals.taxes += n(t.amount) * rate;
          if (cm) addCash(pid, ccy, -n(t.amount)); else flowIn += n(t.amount) * rate;
          break;
      }
    }

    // 4) valuation at today's close
    let value = 0;
    for (const key of book.keys()) {
      const qty = book.qty(key);
      if (qty <= EPS) continue;
      const tk = key.split('|')[1];
      const info = posInfo.get(key);
      const px = market.price(tk, d) ?? lastTxPrice[tk];
      const ccy = market.currency(tk) || info.currency;
      value += qty * (px ?? 0) * fx(ccy, d);
    }
    for (const [key, amt] of cash) {
      const [pid, ccy] = key.split('|');
      if (cashMode[pid]) value += amt * fx(ccy, d);
    }

    // 5) time-weighted return: inflows at start of day, outflows at end of day
    const denom = prevValue + flowIn;
    const r = denom > EPS ? (value - flowOut) / denom - 1 : 0;
    if (Number.isFinite(r)) twrIndex *= 1 + r;
    invested += flowIn + flowOut;
    if (flowIn + flowOut !== 0) xirrFlows.push([d, -(flowIn + flowOut)]);

    result.series.dates.push(d);
    result.series.value.push(value);
    result.series.invested.push(invested);
    result.series.twr.push(twrIndex);
    result.series.flow.push(flowIn + flowOut);
    prevValue = value;
  }

  // ---- holdings snapshot (aggregated by ticker across portfolios)
  const agg = new Map();
  for (const [key, info] of posInfo) {
    const lots = book.get(key);
    const tk = info.ticker;
    if (!agg.has(tk)) agg.set(tk, { ticker: tk, qty: 0, costLocal: 0, costBase: 0, realized: 0, dividends: 0, fees: 0, lots: [], portfolios: new Set(), txCurrency: info.currency });
    const a = agg.get(tk);
    for (const l of lots) {
      a.qty += l.qty;
      a.costLocal += l.qty * l.price + l.fee;
      a.costBase += (l.qty * l.price + l.fee) * l.rate;
      a.lots.push({ ...l, portfolioId: info.pid });
    }
    a.realized += info.realized;
    a.dividends += info.dividends;
    a.fees += info.fees;
    a.portfolios.add(info.pid);
  }

  let holdingsValue = 0;
  for (const a of agg.values()) {
    const ccy = market.currency(a.ticker) || a.txCurrency;
    const price = market.lastPrice(a.ticker) ?? lastTxPrice[a.ticker] ?? 0;
    const prev = market.prevClose(a.ticker);
    const rate = fx(ccy, today);
    const h = {
      ticker: a.ticker, name: market.name(a.ticker), currency: ccy, qty: a.qty, price, prevClose: prev,
      avgPrice: a.qty > EPS ? a.costLocal / a.qty : 0,
      costBase: a.costBase, value: a.qty * price * rate,
      realized: a.realized, dividends: a.dividends, fees: a.fees,
      portfolios: [...a.portfolios], lots: a.lots,
      stalePrice: !market.prices[a.ticker]?.length,
    };
    h.unrealized = h.value - h.costBase;
    h.unrealizedPct = h.costBase > EPS ? h.unrealized / h.costBase : 0;
    h.priceChangePct = h.avgPrice > EPS ? price / h.avgPrice - 1 : 0;
    h.dayChange = prev !== null && a.qty > EPS ? a.qty * (price - prev) * rate : 0;
    h.dayChangePct = prev ? price / prev - 1 : 0;
    h.totalReturn = h.unrealized + h.realized + h.dividends;
    if (a.qty > EPS) {
      holdingsValue += h.value;
      totals.costBasis += h.costBase;
      totals.unrealized += h.unrealized;
      totals.dayChange += h.dayChange;
      result.holdings.push(h);
    } else {
      result.closed.push(h);
    }
  }
  for (const h of result.holdings) h.weight = holdingsValue > EPS ? h.value / holdingsValue : 0;
  result.holdings.sort((x, y) => y.value - x.value);
  result.closed.sort((x, y) => x.ticker.localeCompare(y.ticker));

  let cashValue = 0;
  for (const [key, amt] of cash) {
    const [pid, ccy] = key.split('|');
    if (!cashMode[pid] || Math.abs(amt) < 0.005) continue;
    result.cash[ccy] = (result.cash[ccy] || 0) + amt;
    cashValue += amt * fx(ccy, today);
  }

  totals.holdingsValue = holdingsValue;
  totals.cashValue = cashValue;
  totals.value = holdingsValue + cashValue;
  totals.invested = invested;
  totals.profit = totals.value - invested;
  totals.twr = twrIndex - 1;
  totals.xirr = xirr([...xirrFlows, [today, totals.value]]);
  totals.dayChangePct = holdingsValue - totals.dayChange > EPS ? totals.dayChange / (holdingsValue - totals.dayChange) : 0;
  result.totals = totals;
  result.cashMode = cashMode;
  result.xirrFlows = xirrFlows;
  result.warnings = [...warnings];
  return result;
}

function emptyTotals() {
  return { value: 0, holdingsValue: 0, cashValue: 0, invested: 0, profit: 0, costBasis: 0, unrealized: 0,
    realized: 0, dividends: 0, fees: 0, taxes: 0, interest: 0, dayChange: 0, dayChangePct: 0, twr: 0, xirr: null };
}

function fmtQty(q) { return Math.round(q * 1e6) / 1e6; }

// ---------------------------------------------------------------- returns

/** Annualised money-weighted return. flows: [[date, amount]] (negative = paid in). */
export function xirr(flows) {
  const f = flows.filter(([, a]) => Math.abs(a) > EPS);
  if (f.length < 2 || !f.some(([, a]) => a > 0) || !f.some(([, a]) => a < 0)) return null;
  const t0 = f[0][0];
  const ts = f.map(([d]) => yearFrac(t0, d));
  if (ts[ts.length - 1] < 1 / 365) return null;
  const npv = (r) => f.reduce((s, [, a], i) => s + a / Math.pow(1 + r, ts[i]), 0);
  // bisection over a wide bracket (robust), NPV is decreasing in r for normal flow patterns
  let lo = -0.9999, hi = 100;
  let flo = npv(lo), fhi = npv(hi);
  if (Number.isNaN(flo) || Number.isNaN(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (fm * flo > 0) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
  }
  return (lo + hi) / 2;
}

/** Return/profit between two dates using the daily series. */
export function periodStats(series, fromDate, toDate) {
  const { dates, value, invested, twr } = series;
  if (!dates.length) return null;
  const end = toDate ? Math.max(0, upperIdx(dates, toDate)) : dates.length - 1;
  let start = upperIdx(dates, fromDate);
  const beforeStart = start < 0;
  if (beforeStart) start = 0;
  const v0 = beforeStart ? 0 : value[start], i0 = beforeStart ? 0 : invested[start];
  const idx0 = beforeStart ? 1 : twr[start];
  const profit = (value[end] - v0) - (invested[end] - i0);
  return { from: beforeStart ? dates[0] : dates[start], to: dates[end], profit, twr: twr[end] / idx0 - 1, startValue: v0, endValue: value[end] };
}

function upperIdx(dates, d) {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Benchmark comparison over the portfolio's daily series.
 * Returns both a normalised index (TWR-comparable) and a "same cash flows" simulation:
 * what the portfolio would be worth had every contribution bought the benchmark instead.
 */
export function benchmarkSeries(series, market, ticker, base) {
  const bccy = market.currency(ticker) || 'USD';
  const out = { ticker, index: [], simulated: [] };
  let units = 0, first = null;
  for (let i = 0; i < series.dates.length; i++) {
    const d = series.dates[i];
    const px = market.price(ticker, d);
    const rate = market.fxRate(bccy, base, d) ?? 1;
    const b = px !== null ? px * rate : null;
    if (b !== null && first === null) first = b;
    out.index.push(b !== null && first ? b / first : null);
    if (b) units += series.flow[i] / b;
    out.simulated.push(b !== null ? units * b : null);
  }
  return out;
}

// ---------------------------------------------------------------- dividends

/** Next-12-month dividend forecast from each holding's trailing 12-month payments. */
export function forecastDividends(holdings, market, base, today = todayISO()) {
  const from = addDays(today, -365);
  const items = [];
  for (const h of holdings) {
    if (h.qty <= EPS) continue;
    const ccy = market.currency(h.ticker) || h.currency;
    const rate = market.fxRate(ccy, base, today) ?? 1;
    for (const [d, dps] of market.dividends(h.ticker)) {
      if (d <= from || d > today) continue;
      const amount = dps * h.qty;
      items.push({ date: addYears(d, 1), ticker: h.ticker, currency: ccy, dps, amount, amountBase: amount * rate });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Trailing 12-month dividend per share and yield for a ticker. */
export function trailingYield(market, ticker, today = todayISO()) {
  const from = addDays(today, -365);
  const dps = market.dividends(ticker).filter(([d]) => d > from && d <= today).reduce((s, [, v]) => s + v, 0);
  const px = market.lastPrice(ticker);
  return { dps, yield: px ? dps / px : 0 };
}

// ---------------------------------------------------------------- Polish tax (PIT-38)

/** Add n business days (Mon–Fri) to an ISO date — used for T+2 settlement. */
export function addBusinessDays(iso, k) {
  let d = iso;
  while (k > 0) {
    d = addDays(d, 1);
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) k--;
  }
  return d;
}

export const MAX_LOSS_YEARS = 5;
export const LOSS_ONE_OFF_CAP = 5_000_000;

/**
 * Apply prior-year capital losses (Polish rules since 2019): each loss can be used in the next 5 years,
 * up to 50% of it per year, or once up to PLN 5M in a single year. Greedy: oldest losses first,
 * using the one-off when the 50% cap would leave income untaxed-able.
 * years: [{year, income}] (any order); priorLosses: {year: amount} for losses from before your data.
 */
export function applyLossCarryForward(years, priorLosses = {}) {
  const losses = [];
  for (const [y, amt] of Object.entries(priorLosses)) if (+amt > 0) losses.push({ year: String(y), orig: +amt, left: +amt, oneOffUsed: false });
  const sorted = [...years].sort((a, b) => a.year.localeCompare(b.year));
  for (const y of sorted) {
    y.lossDeductions = [];
    y.lossDeducted = 0;
    let room = Math.max(0, y.income);
    for (const L of losses.sort((a, b) => a.year.localeCompare(b.year))) {
      if (room <= 0) break;
      if (L.left <= 0 || +y.year - +L.year > MAX_LOSS_YEARS || +y.year <= +L.year) continue;
      const half = L.orig * 0.5;
      const cap = L.oneOffUsed ? Math.min(half, L.left) : Math.min(L.left, Math.max(half, LOSS_ONE_OFF_CAP));
      const take = Math.min(cap, room);
      if (take <= 0) continue;
      if (take > half + 1e-6) L.oneOffUsed = true;
      L.left -= take; room -= take;
      y.lossDeducted += take;
      y.lossDeductions.push({ fromYear: L.year, amount: take, oneOff: take > half + 1e-6 });
    }
    if (y.income < 0 && !losses.some((L) => L.year === y.year)) losses.push({ year: y.year, orig: -y.income, left: -y.income, oneOffUsed: false });
  }
  return losses.map((L) => ({ year: L.year, original: L.orig, remaining: L.left, expires: String(+L.year + MAX_LOSS_YEARS) }));
}

const COUNTRY_CODES = {
  'United States': 'US', Poland: 'PL', Germany: 'DE', France: 'FR', Netherlands: 'NL', 'United Kingdom': 'GB', Ireland: 'IE',
  Switzerland: 'CH', Spain: 'ES', Italy: 'IT', Denmark: 'DK', Sweden: 'SE', Norway: 'NO', Finland: 'FI', Canada: 'CA',
  Austria: 'AT', Belgium: 'BE', Japan: 'JP', Luxembourg: 'LU', Portugal: 'PT', 'Czech Republic': 'CZ', Australia: 'AU', 'Hong Kong': 'HK',
};
const SUFFIX_COUNTRY = { WA: 'PL', DE: 'DE', F: 'DE', PA: 'FR', AS: 'NL', L: 'GB', IR: 'IE', SW: 'CH', MC: 'ES', MI: 'IT', CO: 'DK', ST: 'SE', OL: 'NO', HE: 'FI', TO: 'CA', VI: 'AT', BR: 'BE', T: 'JP', LS: 'PT', PR: 'CZ', AX: 'AU', HK: 'HK' };
/** Typical dividend withholding for a Polish resident (treaty rate / W-8BEN), used for estimated dividends. */
export const WITHHOLDING = { US: 0.15, PL: 0.19, DE: 0.26375, FR: 0.128, NL: 0.15, GB: 0, IE: 0.25, CH: 0.35, ES: 0.19, IT: 0.26, DK: 0.27, SE: 0.3, NO: 0.25, FI: 0.35, CA: 0.25, AT: 0.275, BE: 0.3, JP: 0.15315, LU: 0.15, PT: 0.25, CZ: 0.15, AU: 0.3, HK: 0 };

export function countryOf(market, ticker) {
  const name = market.quotes?.[ticker]?.country;
  if (name && COUNTRY_CODES[name]) return COUNTRY_CODES[name];
  const m = String(ticker || '').match(/\.([A-Z]+)$/);
  if (m) return SUFFIX_COUNTRY[m[1]] || null;
  return ticker ? 'US' : null;
}

/**
 * Capital gains and foreign dividend tax per calendar year, Polish rules:
 *  - FIFO per account (portfolio) and ticker,
 *  - foreign amounts converted at the NBP mid rate of the last business day before the
 *    transaction date (or the T+2 settlement date with dateMode 'settlement'),
 *  - fees are deductible costs,
 *  - prior-year losses carried forward (50%/year or one-off up to PLN 5M, 5 years),
 *  - foreign dividends: 19% minus tax withheld abroad (never below zero).
 * Only recorded transactions are used (estimated dividends are not taxable evidence).
 * opts: { dateMode: 'trade'|'settlement', carryForward: true, priorLosses: {year: amount} }
 */
export function computePolishTax(transactions, market, opts = {}) {
  const txs = sortTransactions(transactions);
  const book = new FifoBook();
  const years = {};
  const warnings = new Set();
  const settle = opts.dateMode === 'settlement';
  const year = (y) => (years[y] ??= { year: y, proceeds: 0, costs: 0, income: 0, trades: [], dividends: [], divGross: 0, divWithheld: 0, divToPay: 0, byCountry: {} });
  const country = (y, tk) => {
    const c = countryOf(market, tk) || '??';
    return (y.byCountry[c] ??= { country: c, proceeds: 0, costs: 0, income: 0, divGross: 0, divWithheld: 0, divToPay: 0 });
  };
  const rate = (ccy, d) => {
    const r = market.nbpRate(ccy, d);
    if (r === null) { warnings.add(`No NBP rate for ${ccy} before ${d}.`); return null; }
    return r;
  };
  const tradeRateDate = (d) => (settle ? addBusinessDays(d, 2) : d);

  const tickers = new Set(txs.filter((t) => t.ticker).map((t) => t.ticker));
  const splits = [];
  for (const tk of tickers) for (const [d, r] of market.splits(tk)) splits.push([d, tk, r]);
  splits.sort((a, b) => a[0].localeCompare(b[0]));
  let si = 0;

  for (const t of txs) {
    while (si < splits.length && splits[si][0] <= t.date) { book.split(splits[si][1], splits[si][2]); si++; }
    const ccy = t.currency || market.currency(t.ticker) || 'PLN';
    const key = `${t.portfolioId}|${t.ticker}`;
    if (t.type === 'BUY') {
      const r = rate(ccy, tradeRateDate(t.date));
      book.buy(key, { date: t.date, qty: n(t.quantity), price: n(t.price), fee: n(t.fee), rate: r ?? 0, currency: ccy });
    } else if (t.type === 'SELL') {
      const r = rate(ccy, tradeRateDate(t.date)) ?? 0;
      const qty = n(t.quantity);
      const { used, shortfall } = book.sell(key, qty);
      if (shortfall) warnings.add(`SELL ${t.ticker} on ${t.date}: no matching purchase for ${fmtQty(shortfall)} shares — cost assumed 0.`);
      const proceeds = qty * n(t.price) * r;
      const costs = used.reduce((s, l) => s + (l.qty * l.price + l.fee) * l.rate, 0) + n(t.fee) * r;
      const y = year(t.date.slice(0, 4));
      y.proceeds += proceeds; y.costs += costs; y.income += proceeds - costs;
      const c = country(y, t.ticker);
      c.proceeds += proceeds; c.costs += costs; c.income += proceeds - costs;
      y.trades.push({ date: t.date, portfolioId: t.portfolioId, ticker: t.ticker, qty, currency: ccy, rate: r,
        proceeds, costs, income: proceeds - costs,
        buys: used.map((l) => ({ date: l.date, qty: l.qty, price: l.price, rate: l.rate })) });
    } else if (t.type === 'DIVIDEND') {
      const r = rate(ccy, t.date) ?? 0;
      const gross = n(t.amount) * r, withheld = n(t.tax) * r;
      // Polish companies withhold the 19% themselves; anything else needs the top-up in PIT-38
      const noInfo = !market.quotes?.[t.ticker]?.country && !/\./.test(t.ticker || '');
      const domestic = t.ticker && !noInfo ? countryOf(market, t.ticker) === 'PL' : ccy === 'PLN';
      const toPay = domestic ? 0 : Math.max(0, gross * PL_TAX_RATE - withheld);
      const y = year(t.date.slice(0, 4));
      y.dividends.push({ date: t.date, ticker: t.ticker, currency: ccy, rate: r, gross, withheld, toPay, domestic });
      if (!domestic) {
        y.divGross += gross; y.divWithheld += withheld; y.divToPay += toPay;
        const c = country(y, t.ticker);
        c.divGross += gross; c.divWithheld += withheld; c.divToPay += toPay;
      }
    }
  }

  const list = Object.values(years);
  const lossesLeft = opts.carryForward === false ? [] : applyLossCarryForward(list, opts.priorLosses);
  for (const y of list) {
    y.lossDeducted = opts.carryForward === false ? 0 : (y.lossDeducted || 0);
    y.taxBase = Math.max(0, Math.round(y.income - y.lossDeducted));
    y.tax = Math.round(y.taxBase * PL_TAX_RATE);
    y.loss = y.income < 0 ? -y.income : 0;
    y.divToPayRounded = Math.round(y.divToPay);
    y.countries = Object.values(y.byCountry).sort((a, b) => a.country.localeCompare(b.country));
  }
  return { years: list.sort((a, b) => b.year.localeCompare(a.year)), losses: lossesLeft, warnings: [...warnings] };
}

// ---------------------------------------------------------------- allocation

export function groupBy(holdings, keyFn) {
  const m = new Map();
  for (const h of holdings) {
    const k = keyFn(h) || 'Unknown';
    m.set(k, (m.get(k) || 0) + h.value);
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].map(([label, value]) => ({ label, value, weight: total ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

// ---------------------------------------------------------------- IKE / IKZE

export const ACCOUNT_TYPES = { regular: 'Regular (taxable)', IKE: 'IKE', IKZE: 'IKZE', OIPE: 'OIPE (PEPP)' };
export const TAX_FREE_TYPES = new Set(['IKE', 'IKZE', 'OIPE']);
// Statutory annual contribution limits in PLN (editable in Settings; IKZE ×1.5 for the self-employed).
export const DEFAULT_LIMITS = {
  IKE: { 2019: 13785, 2020: 15681, 2021: 15777, 2022: 17766, 2023: 20805, 2024: 23472, 2025: 26019, 2026: 28260 },
  IKZE: { 2019: 5514, 2020: 6272.4, 2021: 6310.8, 2022: 7106.4, 2023: 8322, 2024: 9388.8, 2025: 10407.6, 2026: 11304 },
};

/**
 * Contributions per calendar year (PLN) for one portfolio. Uses DEPOSITs when the portfolio
 * records them, otherwise net purchases (buys − sells, floored at 0) as an approximation.
 */
export function contributionsByYear(transactions, portfolioId, market) {
  const txs = transactions.filter((t) => t.portfolioId === portfolioId);
  const useDeposits = txs.some((t) => t.type === 'DEPOSIT');
  const pln = (amt, ccy, d) => amt * (market.fxRate(ccy || 'PLN', 'PLN', d) ?? 1);
  const out = {};
  for (const t of txs) {
    const y = t.date.slice(0, 4);
    let v = 0;
    if (useDeposits) {
      if (t.type === 'DEPOSIT') v = pln(n(t.amount), t.currency, t.date);
    } else if (t.type === 'BUY' || t.type === 'SELL') {
      const local = n(t.quantity) * n(t.price) + (t.type === 'BUY' ? 1 : -1) * n(t.fee);
      v = (t.type === 'BUY' ? 1 : -1) * (t.settleCurrency ? pln(n(t.settleAmount), t.settleCurrency, t.date) : pln(local, t.currency, t.date));
    }
    out[y] = (out[y] || 0) + v;
  }
  for (const y of Object.keys(out)) out[y] = Math.max(0, out[y]);
  return { byYear: out, method: useDeposits ? 'deposits' : 'net purchases' };
}

// ---------------------------------------------------------------- rebalancing

/**
 * Plan trades to move towards target weights.
 * rows: [{ key, value, unitPrice }]  — current value and price of one share, both in base currency
 *        (unitPrice may be null for assets that cannot be traded in whole shares here)
 * targets: { key: percent }          — assets without a target are left out of the plan
 * opts: { cash = 0, mode = 'buy' | 'full', wholeShares = true }
 * Returns { total, items: [{ key, value, weight, target, targetValue, drift, amount, shares, after }], cashLeft }
 */
export function rebalancePlan(rows, targets, { cash = 0, mode = 'buy', wholeShares = true } = {}) {
  const keys = new Set([...rows.map((r) => r.key), ...Object.keys(targets)]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const items = [...keys].filter((k) => targets[k] !== undefined && targets[k] !== null && targets[k] !== '')
    .map((k) => ({ key: k, value: byKey[k]?.value || 0, unitPrice: byKey[k]?.unitPrice ?? null, target: +targets[k] / 100 }));
  const invested = items.reduce((s, i) => s + i.value, 0);
  const total = invested + cash;
  const sumT = items.reduce((s, i) => s + i.target, 0) || 1;
  for (const i of items) {
    i.target /= sumT; // normalise in case targets do not add up to exactly 100
    i.weight = invested ? i.value / invested : 0;
    i.targetValue = total * i.target;
    i.gap = i.targetValue - i.value;
  }
  if (mode === 'full') {
    for (const i of items) i.amount = i.gap;
  } else {
    // buy-only: split the new cash across underweight assets in proportion to how far below target they are
    const deficits = items.reduce((s, i) => s + Math.max(0, i.gap), 0);
    const budget = Math.min(cash, deficits);
    for (const i of items) i.amount = deficits > 0 ? (Math.max(0, i.gap) / deficits) * budget : 0;
  }
  let spent = 0;
  for (const i of items) {
    if (wholeShares && i.unitPrice) {
      i.shares = Math.trunc(i.amount / i.unitPrice);
      i.amount = i.shares * i.unitPrice;
    } else i.shares = i.unitPrice ? i.amount / i.unitPrice : null;
    spent += i.amount;
  }
  // whole-share rounding leaves change: buy extra single shares of the most underweight assets while it fits
  if (wholeShares && mode !== 'full') {
    let left = cash - spent;
    for (let guard = 0; guard < 1000; guard++) {
      const cand = items.filter((i) => i.unitPrice && i.unitPrice <= left)
        .sort((a, b) => (a.value + a.amount) / a.targetValue - (b.value + b.amount) / b.targetValue)[0];
      if (!cand || (cand.value + cand.amount) >= cand.targetValue) break;
      cand.shares += 1; cand.amount += cand.unitPrice; left -= cand.unitPrice; spent += cand.unitPrice;
    }
  }
  const after = items.reduce((s, i) => s + i.value + i.amount, 0);
  for (const i of items) {
    i.drift = i.weight - i.target;
    i.after = after ? (i.value + i.amount) / after : 0;
    delete i.gap;
  }
  return { total, items, cashLeft: cash - (mode === 'full' ? items.reduce((s, i) => s + i.amount, 0) : spent) };
}
