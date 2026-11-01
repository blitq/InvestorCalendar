// Custom (manually valued) assets: real estate, term deposits, crypto wallets, collectibles…
// Each asset has valuations [[date, value per unit]]; between valuations the value is held flat,
// or grows at `rate` % a year (e.g. a deposit). Turned into a daily price series for the engine.
import { addDays } from './engine.js';

export const ASSET_KINDS = {
  real_estate: 'Real estate', deposit: 'Deposit / savings', crypto: 'Crypto', gold: 'Gold / metals',
  vehicle: 'Vehicle', collectible: 'Collectibles', private: 'Private equity / loans', other: 'Other',
};
export const isCustomTicker = (t) => String(t || '').startsWith('X:');

export function customTicker(name, existing = {}) {
  const base = 'X:' + (String(name || 'ASSET').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'ASSET');
  let t = base, k = 2;
  while (existing[t]) t = `${base}-${k++}`;
  return t;
}

/** Value per unit on date d (null before the first valuation). */
export function customValueOn(asset, d) {
  const vals = [...(asset.valuations || [])].sort((a, b) => a[0].localeCompare(b[0]));
  let last = null;
  for (const v of vals) if (v[0] <= d) last = v; else break;
  if (!last) return null;
  const rate = +asset.rate || 0;
  if (!rate) return last[1];
  const days = (Date.parse(d + 'T00:00:00Z') - Date.parse(last[0] + 'T00:00:00Z')) / 864e5;
  return last[1] * Math.pow(1 + rate / 100, days / 365);
}

export function customHistory(asset, today) {
  const vals = [...(asset.valuations || [])].sort((a, b) => a[0].localeCompare(b[0]));
  const dates = [], close = [];
  if (vals.length) {
    for (let d = vals[0][0]; d <= today; d = addDays(d, 1)) {
      dates.push(d);
      close.push(Math.round(customValueOn(asset, d) * 1e6) / 1e6);
    }
  }
  return { ticker: asset.ticker, currency: asset.currency || 'PLN', dates, close, dividends: [], splits: [] };
}
