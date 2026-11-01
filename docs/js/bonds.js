// Polish retail treasury bonds (obligacje skarbowe). Each purchase has its own interest periods
// starting on the purchase date. Bonds are modelled as synthetic daily price series (value of one
// 100 PLN bond incl. accrued interest) plus interest payouts, so the normal engine can value them.
import { addDays } from './engine.js';

export const BOND_TYPES = {
  OTS: { months: 3, period: 3, kind: 'fixed', payout: false, fee: 0, label: '3-month fixed' },
  ROR: { months: 12, period: 1, kind: 'ref', payout: true, fee: 0.5, label: '1-year, NBP rate, monthly interest' },
  DOR: { months: 24, period: 1, kind: 'ref', payout: true, fee: 0.7, label: '2-year, NBP rate + margin, monthly interest' },
  TOS: { months: 36, period: 12, kind: 'fixed', payout: false, fee: 0.7, label: '3-year fixed, capitalised' },
  COI: { months: 48, period: 12, kind: 'cpi', payout: true, fee: 0.7, label: '4-year inflation-linked, yearly interest' },
  ROS: { months: 72, period: 12, kind: 'cpi', payout: false, fee: 0.7, label: '6-year inflation-linked (family 800+)' },
  EDO: { months: 120, period: 12, kind: 'cpi', payout: false, fee: 2, label: '10-year inflation-linked, capitalised' },
  ROD: { months: 144, period: 12, kind: 'cpi', payout: false, fee: 2, label: '12-year inflation-linked (family 800+)' },
};
export const NOMINAL = 100;

export function addMonths(iso, k) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
const days = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5;

/** "EDO0335" -> { type: 'EDO', maturity: '2035-03' } */
export function parseSeries(code) {
  const m = String(code || '').toUpperCase().match(/^([A-Z]{3})(\d{2})(\d{2})$/);
  if (!m || !BOND_TYPES[m[1]]) return null;
  return { type: m[1], maturity: `20${m[3]}-${m[2]}` };
}

/** Series code for a purchase: type + maturity month (MMYY). */
export function seriesCode(type, purchaseDate) {
  const mat = addMonths(purchaseDate, BOND_TYPES[type].months);
  return `${type}${mat.slice(5, 7)}${mat.slice(2, 4)}`;
}

/** Ticker for one purchase: series + day of month, e.g. EDO0335#14 (each purchase day has its own schedule). */
export const bondTicker = (type, purchaseDate) => `${seriesCode(type, purchaseDate)}#${purchaseDate.slice(8, 10)}`;
export const isBondTicker = (t) => /^[A-Z]{3}\d{4}#\d{2}$/.test(String(t || ''));

/** CPI y/y (in %) for a month 'YYYY-MM'; falls back to the latest available month. */
function cpiFor(cpi, month) {
  const i = cpi?.months?.indexOf(month) ?? -1;
  if (i >= 0) return { value: cpi.yoy[i], month, estimated: false };
  if (!cpi?.months?.length) return null;
  const k = cpi.months.length - 1;
  return month > cpi.months[k] ? { value: cpi.yoy[k], month: cpi.months[k], estimated: true } : null;
}

/**
 * Interest periods with their annual rates (percent).
 * bond: { type, purchaseDate, firstRate, margin = 0, overrides = {periodIndex: rate} }
 */
export function schedule(bond, cpi) {
  const def = BOND_TYPES[bond.type];
  const periods = [];
  const n = Math.round(def.months / def.period);
  for (let k = 0; k < n; k++) {
    const start = addMonths(bond.purchaseDate, k * def.period), end = addMonths(bond.purchaseDate, (k + 1) * def.period);
    const p = { idx: k, start, end, rate: +bond.firstRate || 0, source: k === 0 ? 'first year' : 'fixed' };
    if (k > 0 && def.kind === 'cpi') {
      const cpiMonth = addMonths(start.slice(0, 7) + '-01', -2).slice(0, 7); // inflation from 2 months before the period
      const c = cpiFor(cpi, cpiMonth);
      p.cpiMonth = cpiMonth;
      if (c) { p.cpi = c.value; p.rate = Math.max(0, c.value) + (+bond.margin || 0); p.source = c.estimated ? `estimate (CPI ${c.month})` : `CPI ${cpiMonth}`; }
      else { p.rate = +bond.margin || 0; p.source = 'no CPI data'; }
    }
    if (k > 0 && def.kind === 'ref') p.source = 'current rate';
    const ov = bond.overrides?.[k];
    if (ov !== undefined && ov !== null && ov !== '') { p.rate = +ov; p.source = 'entered'; }
    periods.push(p);
  }
  return periods;
}

/** Value of one bond on date d (accrued, before tax and early-redemption fee) and payouts so far. */
export function valueOn(bond, periods, d) {
  const def = BOND_TYPES[bond.type];
  let base = NOMINAL, paid = 0;
  const payouts = [];
  for (const p of periods) {
    const yearFrac = def.period / 12;
    if (d >= p.end) {
      const interest = base * (p.rate / 100) * yearFrac;
      if (def.payout) { paid += interest; payouts.push([p.end, interest]); } else base += interest;
      continue;
    }
    if (d < p.start) break;
    const frac = days(p.start, d) / days(p.start, p.end);
    return { value: base + base * (p.rate / 100) * yearFrac * frac, accrued: base * (p.rate / 100) * yearFrac * frac, paid, payouts, matured: false };
  }
  return { value: base, accrued: 0, paid, payouts, matured: true };
}

/** Synthetic market history for the engine: daily value per bond and interest payouts as dividends. */
export function bondHistory(bond, cpi, today) {
  const periods = schedule(bond, cpi);
  const end = periods[periods.length - 1].end;
  const stop = today < end ? today : end;
  const dates = [], close = [];
  for (let d = bond.purchaseDate; d <= stop; d = addDays(d, 1)) {
    dates.push(d);
    close.push(Math.round(valueOn(bond, periods, d).value * 1e6) / 1e6);
  }
  // all scheduled payouts, future ones included: the engine only books those up to today,
  // and the dividend forecast uses the future ones
  const { payouts } = valueOn(bond, periods, end);
  return { ticker: bond.ticker, currency: 'PLN', dates, close, dividends: payouts, splits: [], maturity: end, periods };
}

/** What you would get for one bond if redeemed on d: fee (capped at accrued interest) and 19% tax on interest. */
export function redemption(bond, periods, d, { taxFree = false } = {}) {
  const v = valueOn(bond, periods, d);
  const interest = v.value - NOMINAL;
  const fee = v.matured ? 0 : Math.min(+(bond.fee ?? BOND_TYPES[bond.type].fee), Math.max(0, interest));
  const taxable = Math.max(0, interest - fee);
  const tax = taxFree ? 0 : Math.round(taxable * 0.19 * 100) / 100;
  return { gross: v.value, fee, tax, net: v.value - fee - tax, matured: v.matured };
}

export function bondName(bond) {
  const def = BOND_TYPES[bond.type];
  const mat = addMonths(bond.purchaseDate, def.months);
  return `${bond.type} ${mat.slice(5, 7)}/${mat.slice(0, 4)} · bought ${bond.purchaseDate}`;
}
