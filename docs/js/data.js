// Loads the static JSON produced by backend/generate.py (served from docs/data/).
import { Market } from './engine.js';

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
export async function buildMarket(tickers, { manualPrices = {}, withNbp = false, extra = [] } = {}) {
  const [quotes, fx, histories, nbp] = await Promise.all([
    loadQuotes(), loadFx(), loadHistories([...tickers, ...extra]), withNbp ? loadNbp() : Promise.resolve({}),
  ]);
  return new Market({ quotes, fx, histories, nbp, manualPrices });
}
