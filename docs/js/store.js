// Local persistence. Your portfolio never leaves the browser: it lives in localStorage
// and can be exported/imported as a JSON backup (e.g. to move between devices).

const KEY = 'scrabfree_v1';
const listeners = new Set();

const DEFAULT_STATE = () => ({
  version: 1,
  portfolios: [{ id: 'main', name: 'Main' }],
  transactions: [],
  settings: {
    baseCurrency: 'PLN',
    autoDividends: true,
    benchmark: '',
    manualPrices: {},   // ticker -> { price, currency }
    watchlist: [],
    symbolMap: {},      // symbol in a broker file -> Yahoo ticker (remembered between imports)
    lang: 'en',
  },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('Could not read saved portfolio', e); }
  return DEFAULT_STATE();
}

function migrate(s) {
  const d = DEFAULT_STATE();
  return {
    ...d, ...s,
    portfolios: s.portfolios?.length ? s.portfolios : d.portfolios,
    transactions: Array.isArray(s.transactions) ? s.transactions : [],
    settings: { ...d.settings, ...(s.settings || {}) },
  };
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { alert('Saving failed (storage full or blocked): ' + e.message); }
  for (const fn of listeners) fn(state);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const store = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  setSettings(patch) { state.settings = { ...state.settings, ...patch }; persist(); },

  addPortfolio(name) { const p = { id: uid(), name }; state.portfolios.push(p); persist(); return p; },
  renamePortfolio(id, name) { const p = state.portfolios.find((x) => x.id === id); if (p) { p.name = name; persist(); } },
  deletePortfolio(id) {
    if (state.portfolios.length <= 1) return false;
    state.portfolios = state.portfolios.filter((p) => p.id !== id);
    state.transactions = state.transactions.filter((t) => t.portfolioId !== id);
    persist();
    return true;
  },

  upsertTransaction(tx) {
    const t = { ...tx, id: tx.id || uid() };
    const i = state.transactions.findIndex((x) => x.id === t.id);
    if (i >= 0) state.transactions[i] = t; else state.transactions.push(t);
    persist();
    return t;
  },
  addTransactions(list) {
    for (const tx of list) state.transactions.push({ ...tx, id: tx.id || uid() });
    persist();
  },
  /** Rename tickers in all transactions, e.g. { 'ISIN:US0378331005': 'AAPL' } once the backend resolved it. */
  renameTickers(map) {
    let n = 0;
    for (const t of state.transactions) if (t.ticker && map[t.ticker]) { t.ticker = map[t.ticker]; n++; }
    if (n) persist();
    return n;
  },
  deleteTransactions(ids) {
    const s = new Set(ids);
    state.transactions = state.transactions.filter((t) => !s.has(t.id));
    persist();
  },

  exportJSON() { return JSON.stringify(state, null, 1); },
  importJSON(text, { merge = false } = {}) {
    const incoming = migrate(JSON.parse(text));
    if (merge) {
      const ids = new Set(state.transactions.map((t) => t.id));
      const pids = new Set(state.portfolios.map((p) => p.id));
      state.portfolios.push(...incoming.portfolios.filter((p) => !pids.has(p.id)));
      state.transactions.push(...incoming.transactions.filter((t) => !ids.has(t.id)));
    } else {
      state = incoming;
    }
    persist();
  },
  reset() { state = DEFAULT_STATE(); persist(); },
  loadDemo(demo) { state = migrate(demo); persist(); },
};
