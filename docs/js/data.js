// Loads the static JSON produced by backend/generate.py (served from docs/data/).
import { Market, todayISO } from './engine.js';
import { bondHistory, bondName, isBondTicker } from './bonds.js';
import { customHistory, isCustomTicker, ASSET_KINDS } from './customassets.js';

const cache = new Map();

async function getJSON(path, fallback) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(`data/${path}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path}: HTTP ${r.status}`))))
    .catch((e) => { if (fallback !== undefined) { console.warn(e); return fallback; } throw e; });
  cache.set(path, p);
  return p;
}

export const loadMeta = () => getJSON('meta.json', { tickers: [], benchmarks: {}, files: {} });
export const loadQuotes = () => getJSON('quotes.json', {});
export const loadFx = () => getJSON('fx.json', {});
export const loadNbp = () => getJSON('nbp.json', {});
export const loadEvents = () => getJSON('events.json', { events: [] });
export const loadCpi = () => getJSON('cpi.json', { months: [], yoy: [] });

export async function loadHistories(tickers) {
  const meta = await loadMeta();
  const out = {};
  await Promise.all([...new Set(tickers)].map(async (t) => {
    const f = meta.files?.[t];
    if (!f) return;
    const h = await getJSON(f, null);
    if (h) out[t] = h;
  }));
  return out;
}

/** Build a Market for the given tickers (+ benchmarks). */
export async function buildMarket(tickers, { manualPrices = {}, withNbp = false, extra = [], bonds = {}, customAssets = {} } = {}) {
  const bondTickers = tickers.filter((t) => (isBondTicker(t) && bonds[t]) || (isCustomTicker(t) && customAssets[t]));
  const [quotes, fx, histories, nbp, cpi] = await Promise.all([
    loadQuotes(), loadFx(), loadHistories([...tickers.filter((t) => !bondTickers.includes(t)), ...extra]),
    withNbp ? loadNbp() : Promise.resolve({}), bondTickers.length ? loadCpi() : Promise.resolve(null),
  ]);
  // treasury bonds: synthetic daily value + interest payouts computed from the bond's terms
  const q = { ...quotes };
  for (const t of bondTickers) {
    if (isCustomTicker(t)) {
      const a = { ...customAssets[t], ticker: t };
      histories[t] = customHistory(a, todayISO());
      q[t] = { ticker: t, name: a.name, currency: a.currency || 'PLN', market: 'Custom assets', sector: ASSET_KINDS[a.kind] || 'Other', quote_type: 'CUSTOM', custom: true };
      continue;
    }
    const bond = { ...bonds[t], ticker: t };
    histories[t] = bondHistory(bond, cpi, todayISO());
    q[t] = { ticker: t, name: bondName(bond), currency: 'PLN', country: 'Poland', market: 'Treasury bonds', sector: 'Government bonds', quote_type: 'BOND', bond: true };
  }
  return new Market({ quotes: q, fx, histories, nbp, manualPrices });
}
