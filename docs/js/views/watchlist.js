// watchlist page — split from the former views.js
import { addDays, todayISO, Series } from '../engine.js';
import { loadEvents, loadHistories } from '../data.js';
import { store } from '../store.js';
import { t as tr } from '../i18n.js';
import { $, esc, money, num, pct, cls, fmtDate, toast, table } from '../ui.js';
import { short } from './common.js';
import { settings } from './settings.js';


export async function watchlist(el, ctx) {
  const { meta, quotes, settings } = ctx;
  const held = new Set(ctx.result.holdings.map((h) => h.ticker));
  const list = [...new Set([...(meta.tickers || []), ...(settings.watchlist || []), ...held])].sort();
  const hist = await loadHistories(list);
  const { events } = await loadEvents();
  const today = todayISO();
  const rows = list.map((t) => {
    const q = quotes[t] || {};
    const s = hist[t] ? new Series(hist[t].dates, hist[t].close) : null;
    const px = s?.last ?? q.price;
    const ch = (days) => { const a = s?.at(addDays(today, -days)); return a && px ? px / a - 1 : null; };
    const dps = (hist[t]?.dividends || []).filter(([d]) => d > addDays(today, -365)).reduce((a, [, v]) => a + v, 0);
    const next = events.find((e) => e.ticker === t && e.date >= today);
    return { ticker: t, name: q.name || t, currency: q.currency, price: px, day: q.prev_close && px ? px / q.prev_close - 1 : null,
      m1: ch(30), y1: ch(365), pe: q.pe, yield: px ? dps / px : 0, lo: q.low_52w, hi: q.high_52w, next, held: held.has(t), noData: !hist[t], userAdded: (settings.watchlist || []).includes(t) };
  });
  el.innerHTML = `
  <div class="card"><div class="card-head wrap"><h3>Watchlist</h3>
    <form id="wlAdd" class="row gap"><input name="t" placeholder="Add ticker (Yahoo symbol)" class="sm" required><button class="btn">Add</button></form></div>
    <p class="muted small">Tickers in <code>tickers.json</code> get daily prices and events. Tickers you add here are saved in your browser; to get their data add them to <code>tickers.json</code> too (<a href="#/settings">Settings → Market data</a>).</p>
    <div id="wlT"></div></div>`;
  table($('#wlT'), rows, [
    { key: 'ticker', label: tr('Ticker'), render: (x) => `<b>${esc(x.ticker)}</b>${x.held ? ' <span class="tag">held</span>' : ''}${x.noData ? ' <span class="tag warn">no data</span>' : ''}<div class="muted small">${esc(short(x.name, 28))}</div>` },
    { key: 'price', label: tr('Price'), cls: 'num', render: (x) => money(x.price, x.currency) },
    { key: 'day', label: tr('Day'), cls: 'num', render: (x) => `<span class="${cls(x.day)}">${pct(x.day)}</span>` },
    { key: 'm1', label: tr('1M'), cls: 'num', render: (x) => `<span class="${cls(x.m1)}">${pct(x.m1)}</span>` },
    { key: 'y1', label: tr('1Y'), cls: 'num', render: (x) => `<span class="${cls(x.y1)}">${pct(x.y1)}</span>` },
    { key: 'range', label: tr('52w range'), sort: (x) => (x.hi > x.lo ? (x.price - x.lo) / (x.hi - x.lo) : 0), render: (x) => (x.hi > x.lo ? `<div class="range"><i style="left:${Math.max(0, Math.min(100, ((x.price - x.lo) / (x.hi - x.lo)) * 100)).toFixed(0)}%"></i></div><div class="small muted">${num(x.lo)} – ${num(x.hi)}</div>` : '—') },
    { key: 'pe', label: tr('P/E'), cls: 'num', render: (x) => (x.pe ? num(x.pe, 1) : '—') },
    { key: 'yield', label: tr('Div. yield'), cls: 'num', render: (x) => (x.yield ? pct(x.yield, { sign: false }) : '—') },
    { key: 'next', label: tr('Next event'), sort: (x) => x.next?.date || '9999', render: (x) => (x.next ? `<span class="tag ${x.next.type}">${x.next.type}</span> <span class="small">${fmtDate(x.next.date, { month: 'short', day: 'numeric' })}</span>` : '') },
    { key: 'alert', label: tr('Alert'), sort: (x) => (settings.alerts || []).filter((a) => a.ticker === x.ticker).length, render: (x) => `${(settings.alerts || []).filter((a) => a.ticker === x.ticker).map((a) => `<span class="tag ${a.op === 'above' ? 'buy' : 'sell'}">${a.op === 'above' ? '≥' : '≤'} ${num(a.price, 4)} <button class="icon-btn tiny" data-rmalert="${esc(a.id)}" title="Remove alert">✕</button></span>`).join(' ')}
      <button class="icon-btn" data-alert="${esc(x.ticker)}" data-px="${x.price ?? ''}" title="Add price alert">🔔</button>` },
    { key: 'rm', label: '', render: (x) => (x.userAdded ? `<button class="icon-btn" data-rm="${esc(x.ticker)}" title="Remove">✕</button>` : '') },
  ], { sortKey: 'ticker', sortDir: 1 });
  $('#wlAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = e.target.t.value.trim().toUpperCase();
    if (t) store.setSettings({ watchlist: [...new Set([...(settings.watchlist || []), t])] });
  });
  $('#wlT').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) store.setSettings({ watchlist: settings.watchlist.filter((x) => x !== b.dataset.rm) });
    const ra = e.target.closest('[data-rmalert]');
    if (ra) store.setSettings({ alerts: (settings.alerts || []).filter((a) => a.id !== ra.dataset.rmalert) });
    const al = e.target.closest('[data-alert]');
    if (al) {
      const cur = +al.dataset.px;
      const ans = prompt(`Alert for ${al.dataset.alert}${cur ? ` (now ${num(cur, 4)})` : ''}.\nType a price; above the current price alerts when it rises to it, below when it falls to it. Prefix with > or < to choose explicitly.`, cur ? num(cur * 1.1, 2).replace(/[^\d.,]/g, '').replace(',', '.') : '');
      if (!ans) return;
      const m = ans.trim().match(/^([<>])?\s*([\d.,]+)$/);
      if (!m) return toast('Could not read that price', 'error');
      const price = parseFloat(m[2].replace(',', '.'));
      const op = m[1] === '>' ? 'above' : m[1] === '<' ? 'below' : (cur && price < cur ? 'below' : 'above');
      store.setSettings({ alerts: [...(settings.alerts || []), { id: Date.now().toString(36), ticker: al.dataset.alert, op, price, created: todayISO() }] });
      if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
      toast(`Alert set: ${al.dataset.alert} ${op} ${price}`);
    }
  });
}
