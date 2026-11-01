// App shell: routing, portfolio selection, computing the shared context for views.
import { computePortfolio } from './engine.js';
import { buildMarket, loadMeta, loadQuotes, loadFx } from './data.js';
import { store } from './store.js';
import { $, $$, esc, destroyCharts } from './ui.js';
import * as views from './views.js';
import { startAutoSync } from './sync.js';
import { setLang, startTranslation } from './i18n.js';

const ROUTES = [
  ['dashboard', 'Dashboard', '◧'],
  ['holdings', 'Holdings', '▤'],
  ['transactions', 'Transactions', '⇄'],
  ['dividends', 'Dividends', '◎'],
  ['analysis', 'Analysis', '◔'],
  ['rebalance', 'Rebalance', '⚖'],
  ['goals', 'Goals', '⚑'],
  ['calendar', 'Calendar', '▦'],
  ['taxes', 'Taxes (PIT-38)', '§'],
  ['watchlist', 'Watchlist', '☆'],
  ['settings', 'Settings', '⚙'],
];

const PF_KEY = 'scrabfree_portfolio';
let selected = (() => { try { return localStorage.getItem(PF_KEY) || 'all'; } catch { return 'all'; } })();
let version = 0;
let ctxCache = null;
let rendering = 0;

export function repoUrl() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? `https://github.com/${m[1]}/${repo}` : 'https://github.com/blitq/InvestorCalendar';
}

async function getContext() {
  if (ctxCache && ctxCache.version === version) return ctxCache;
  const state = store.get();
  const { settings } = state;
  if (!state.portfolios.some((p) => p.id === selected)) selected = 'all';
  const txs = selected === 'all' ? state.transactions : state.transactions.filter((t) => t.portfolioId === selected);
  const [meta, quotes, fx] = await Promise.all([loadMeta(), loadQuotes(), loadFx()]);
  // ISINs imported earlier (e.g. Degiro) that the data workflow has since resolved -> real tickers
  const resolved = Object.fromEntries(Object.entries(meta.isins || {}).map(([i, t]) => [`ISIN:${i}`, t]));
  if (state.transactions.some((t) => resolved[t.ticker]) && store.renameTickers(resolved)) return getContext();
  const tickers = [...new Set(state.transactions.filter((t) => t.ticker).map((t) => t.ticker))];
  const benchmarks = Object.keys(meta.benchmarks || {});
  const market = await buildMarket(tickers, { manualPrices: settings.manualPrices, extra: benchmarks, bonds: settings.bonds || {} });
  const base = settings.baseCurrency || 'PLN';
  const result = computePortfolio(txs, market, { base, autoDividends: settings.autoDividends, estimateWithholding: settings.estimateWithholding });
  const missing = tickers.filter((t) => !meta.files?.[t] && !settings.manualPrices?.[t] && !settings.bonds?.[t]);
  ctxCache = { version, state, settings, selected, txs, meta, quotes, fx, market, base, result, missing, benchmarks, repoUrl: repoUrl(),
    portfolioName: (id) => state.portfolios.find((p) => p.id === id)?.name || id,
    invalidate, navigate, setSelected };
  return ctxCache;
}

export function invalidate() { version++; render(); }

function setSelected(id) {
  selected = id;
  try { localStorage.setItem(PF_KEY, id); } catch { /* private mode */ }
  invalidate();
}

function navigate(route) { location.hash = '#/' + route; }

const HIDDEN_ROUTES = ['shared'];
function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.some(([k]) => k === r) || HIDDEN_ROUTES.includes(r) ? r : 'dashboard';
}

function renderNav(route) {
  $('#nav').innerHTML = ROUTES.map(([k, label, icon]) =>
    `<a href="#/${k}" class="${k === route ? 'active' : ''}"><span class="ico">${icon}</span><span>${esc(label)}</span></a>`).join('');
}

function renderTopbar(ctx) {
  const { state } = ctx;
  const opts = [['all', 'All portfolios'], ...state.portfolios.map((p) => [p.id, p.name])];
  $('#pfSelect').innerHTML = opts.map(([id, name]) => `<option value="${esc(id)}" ${id === ctx.selected ? 'selected' : ''}>${esc(name)}</option>`).join('');
  const ccys = ['USD', ...Object.keys(ctx.fx || {})].sort();
  if (!ccys.includes(ctx.base)) ccys.push(ctx.base);
  $('#ccySelect').innerHTML = ccys.map((c) => `<option ${c === ctx.base ? 'selected' : ''}>${c}</option>`).join('');
  const gen = ctx.meta.generated_at ? new Date(ctx.meta.generated_at) : null;
  $('#dataStamp').textContent = gen ? `Prices as of ${gen.toLocaleDateString()} ${gen.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No market data yet';
}

export async function render() {
  const token = ++rendering;
  const route = currentRoute();
  renderNav(route);
  document.body.dataset.route = route;
  const main = $('#main');
  if (!ctxCache || ctxCache.version !== version) main.innerHTML = '<div class="loading"><span class="spinner"></span> Crunching numbers…</div>';
  try {
    const ctx = await getContext();
    if (token !== rendering) return;
    renderTopbar(ctx);
    destroyCharts();
    main.innerHTML = '';
    await views[route](main, ctx);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card error"><h3>Something went wrong</h3><pre>${esc(e.stack || e.message)}</pre></div>`;
  }
  $('#sidebar').classList.remove('open');
}

function init() {
  const pref = store.get().settings.lang;
  setLang(pref || ((navigator.language || '').toLowerCase().startsWith('pl') ? 'pl' : 'en'));
  startTranslation(document.body);
  $('#pfSelect').addEventListener('change', (e) => setSelected(e.target.value));
  $('#ccySelect').addEventListener('change', (e) => store.setSettings({ baseCurrency: e.target.value }));
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('scrabfree_theme', next); } catch { /* ignore */ }
    render();
  });
  store.subscribe(() => invalidate());
  startAutoSync(store, (cfg) => {
    const el = $('#syncStamp');
    if (el) el.textContent = cfg?.error ? `Sync error: ${cfg.error}` : cfg?.lastSync ? `Synced ${new Date(cfg.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  });
  window.addEventListener('hashchange', render);
  render();
}

try { const t = localStorage.getItem('scrabfree_theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
$$('[data-repo-link]').forEach((a) => { a.href = repoUrl() + a.getAttribute('data-repo-link'); });
init();
