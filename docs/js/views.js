// All page views. Each export renders into `el` using the shared context from app.js.
import {
  TX_TYPES, addDays, todayISO, periodStats, benchmarkSeries, forecastDividends, trailingYield,
  computePolishTax, groupBy, Series,
} from './engine.js';
import { buildMarket, loadEvents, loadHistories, loadNbp } from './data.js';
import { parseCSV, detectColumns, rowsToTransactions, toCSV, FIELDS, txFingerprint } from './importers.js';
import { store } from './store.js';
import { masterChart } from './masterchart.js';
import { detectBroker, PARSERS, BROKER_NAMES } from './brokers.js';
import {
  $, $$, esc, money, num, qty, pct, cls, fmtDate, kpi, toast, download, readFile, table, chart, cssVar, PALETTE, downsample,
} from './ui.js';

const RANGES = [['1M', 30], ['3M', 91], ['YTD', 'ytd'], ['1Y', 365], ['3Y', 1096], ['5Y', 1827], ['Max', null]];

function rangeStart(range, firstDate, today = todayISO()) {
  if (range === null) return firstDate;
  if (range === 'ytd') return today.slice(0, 4) + '-01-01';
  return addDays(today, -range);
}

function emptyState(el, ctx) {
  el.innerHTML = `
  <div class="hero card">
    <h2>Track your whole portfolio — free, private, no account</h2>
    <p>Add your transactions (or import a CSV from your broker) and get value history, profit, time- and money-weighted returns,
    dividends, allocation, a corporate events calendar and a Polish PIT-38 tax estimate. Your data stays in this browser.</p>
    <div class="row gap">
      <a class="btn primary" href="#/transactions?add=1">+ Add first transaction</a>
      <a class="btn" href="#/transactions?import=1">Import CSV</a>
      <button class="btn ghost" id="demoBtn">Load demo portfolio</button>
    </div>
  </div>`;
  $('#demoBtn', el).addEventListener('click', loadDemo);
}

async function loadDemo() {
  if (store.get().transactions.length && !confirm('Replace your current data with the demo portfolio?')) return;
  const r = await fetch('demo.json');
  store.loadDemo(await r.json());
  toast('Demo portfolio loaded');
}

function warningsBlock(ctx) {
  const w = [...ctx.result.warnings];
  if (ctx.missing.length) {
    w.unshift(`No market data for ${ctx.missing.join(', ')}. Add them to tickers.json (Settings → Market data) or set a manual price.`);
  }
  return w.length ? `<div class="alert"><b>Heads up:</b><ul>${w.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
}

// ======================================================================= dashboard

export async function dashboard(el, ctx) {
  const { result: r, base, market } = ctx;
  if (!ctx.txs.length) return emptyState(el, ctx);
  const t = r.totals;
  const today = r.today;
  const forecast = forecastDividends(r.holdings, market, base, today);
  const fwdDiv = forecast.reduce((s, f) => s + f.amountBase, 0);
  const div12 = r.dividends.filter((d) => d.date > addDays(today, -365)).reduce((s, d) => s + d.netBase, 0);

  el.innerHTML = `
  ${warningsBlock(ctx)}
  <div class="kpis">
    ${kpi('Portfolio value', money(t.value, base), t.cashValue ? `incl. cash ${money(t.cashValue, base)}` : `${r.holdings.length} positions`)}
    ${kpi('Total profit', `<span class="${cls(t.profit)}">${money(t.profit, base, { sign: true })}</span>`, `net invested ${money(t.invested, base)}`)}
    ${kpi('Today', `<span class="${cls(t.dayChange)}">${money(t.dayChange, base, { sign: true })}</span>`, pct(t.dayChangePct), cls(t.dayChange))}
    ${kpi('Return (TWR)', `<span class="${cls(t.twr)}">${pct(t.twr)}</span>`, 'time-weighted, since start')}
    ${kpi('Annual return (XIRR)', `<span class="${cls(t.xirr)}">${pct(t.xirr)}</span>`, 'money-weighted, p.a.')}
    ${kpi('Dividends', money(div12, base), `last 12m · next 12m ≈ ${money(fwdDiv, base, { compact: true })}`)}
  </div>
  <div class="card">
    <div class="card-head"><h3>Returns by period</h3></div>
    <div class="periods" id="periods"></div>
  </div>
  <div id="masterHost"></div>
  <div class="grid-2-1">
    <div class="card">
      <div class="card-head"><h3>Allocation</h3><a href="#/analysis" class="link">details →</a></div>
      <div class="grid-2 alloc-inner"><div class="chart-box small"><canvas id="allocChart"></canvas></div><div id="allocLegend" class="legend-list"></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Today's movers</h3></div>
      <div id="movers"></div>
      <div class="card-head" style="margin-top:14px"><h3>Upcoming events</h3><a href="#/calendar" class="link">calendar →</a></div>
      <div id="upcoming" class="upcoming"></div>
    </div>
  </div>`;

  // periods strip
  const pr = [['1D', addDays(today, -1)], ['1W', addDays(today, -7)], ['1M', addDays(today, -30)], ['3M', addDays(today, -91)],
    ['YTD', `${+today.slice(0, 4) - 1}-12-31`], ['1Y', addDays(today, -365)], ['3Y', addDays(today, -1096)], ['Max', '0000-00-00']];
  $('#periods').innerHTML = pr.map(([label, from]) => {
    const p = periodStats(r.series, from);
    return `<div class="period"><div class="p-label">${label}</div><div class="p-val ${cls(p?.twr)}">${pct(p?.twr)}</div><div class="p-sub ${cls(p?.profit)}">${money(p?.profit, base, { sign: true, compact: true })}</div></div>`;
  }).join('');

  // allocation
  const alloc = groupBy([...r.holdings, ...(t.cashValue > 0 ? [{ ticker: 'Cash', value: t.cashValue }] : [])], (h) => h.ticker);
  doughnut($('#allocChart'), $('#allocLegend'), alloc.slice(0, 8).concat(alloc.length > 8 ? [{ label: 'Other', value: alloc.slice(8).reduce((s, a) => s + a.value, 0), weight: alloc.slice(8).reduce((s, a) => s + a.weight, 0) }] : []), base);

  // movers
  const movers = [...r.holdings].filter((h) => h.prevClose).sort((a, b) => Math.abs(b.dayChangePct) - Math.abs(a.dayChangePct)).slice(0, 5);
  $('#movers').innerHTML = movers.length ? movers.map((h) => `<div class="mini-row"><span><b>${esc(h.ticker)}</b> <span class="muted">${esc(short(h.name))}</span></span>
    <span class="${cls(h.dayChangePct)}">${pct(h.dayChangePct)} <span class="muted">${money(h.dayChange, base, { sign: true })}</span></span></div>`).join('') : '<div class="muted">No price changes.</div>';

  // upcoming
  const held = new Set(r.holdings.map((h) => h.ticker));
  const { events } = await loadEvents();
  await masterChart($('#masterHost'), ctx, events);
  const until = addDays(today, 30);
  const up = events.filter((e) => held.has(e.ticker) && e.date >= today && e.date <= until).slice(0, 8);
  $('#upcoming').innerHTML = up.length ? up.map((e) => `<div class="mini-row"><span><span class="tag ${e.type}">${e.type}</span> <b>${esc(e.ticker)}</b></span><span class="muted">${fmtDate(e.date)}</span></div>`).join('') : '<div class="muted">Nothing in the next 30 days.</div>';
}

function short(s, n = 22) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function segmented(el, items, initial, onChange) {
  el.innerHTML = items.map(([label]) => `<button data-l="${label}" class="${label === initial ? 'on' : ''}">${label}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', el).forEach((x) => x.classList.toggle('on', x === b));
    onChange(items.find(([l]) => l === b.dataset.l)[1]);
  });
  onChange(items.find(([l]) => l === initial)[1]);
}

function lineOpts(unit) {
  const fmt = unit === '%' ? (v) => `${num(v, 1)}%` : (v) => money(v, unit, { compact: true });
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { boxWidth: 12, usePointStyle: true } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y === null ? '—' : fmt(c.parsed.y)}` } },
    },
    scales: {
      x: { ticks: { maxTicksLimit: 7, maxRotation: 0, callback(v) { const l = this.getLabelForValue(v); return l ? fmtDate(l, { month: 'short', year: '2-digit' }) : ''; } }, grid: { display: false } },
      y: { ticks: { callback: fmt } },
    },
  };
}

function doughnut(canvas, legendEl, groups, base) {
  chart(canvas, {
    type: 'doughnut',
    data: { labels: groups.map((g) => g.label), datasets: [{ data: groups.map((g) => g.value), backgroundColor: groups.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderColor: cssVar('--card') }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', animation: false, plugins: { legend: { display: false },
      tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed, base)} (${pct(groups[c.dataIndex].weight, { sign: false })})` } } } },
  });
  if (legendEl) legendEl.innerHTML = groups.map((g, i) => `<div class="mini-row"><span><i class="dot" style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(short(g.label, 26))}</span><span>${pct(g.weight, { sign: false, digits: 1 })}</span></div>`).join('');
}

// ======================================================================= holdings

export async function holdings(el, ctx) {
  const { result: r, base } = ctx;
  if (!ctx.txs.length) return emptyState(el, ctx);
  const t = r.totals;
  el.innerHTML = `
  ${warningsBlock(ctx)}
  <div class="kpis">
    ${kpi('Market value', money(t.holdingsValue, base))}
    ${kpi('Cost basis', money(t.costBasis, base))}
    ${kpi('Unrealized', `<span class="${cls(t.unrealized)}">${money(t.unrealized, base, { sign: true })}</span>`, pct(t.costBasis ? t.unrealized / t.costBasis : 0), cls(t.unrealized))}
    ${kpi('Realized', `<span class="${cls(t.realized)}">${money(t.realized, base, { sign: true })}</span>`)}
    ${kpi('Dividends', money(t.dividends, base))}
    ${kpi('Fees paid', money(t.fees, base))}
  </div>
  <div class="card"><div class="card-head"><h3>Open positions</h3><span class="muted">click a row for details</span></div><div id="hTable"></div></div>
  ${Object.keys(r.cash).length ? `<div class="card"><div class="card-head"><h3>Cash</h3></div>${Object.entries(r.cash).map(([c, v]) => `<div class="mini-row"><span>${c}</span><span>${money(v, c)}</span></div>`).join('')}</div>` : ''}
  <div class="card"><div class="card-head"><h3>Closed positions</h3></div><div id="cTable"></div></div>`;

  table($('#hTable', el), r.holdings, [
    { key: 'ticker', label: 'Asset', render: (h) => `<b>${esc(h.ticker)}</b>${h.stalePrice ? ' <span class="tag warn" title="no market data">manual</span>' : ''}<div class="muted small">${esc(short(h.name, 30))}</div>` },
    { key: 'qty', label: 'Shares', cls: 'num', render: (h) => qty(h.qty) },
    { key: 'avgPrice', label: 'Avg price', cls: 'num', render: (h) => money(h.avgPrice, h.currency) },
    { key: 'price', label: 'Price', cls: 'num', render: (h) => `${money(h.price, h.currency)}<div class="small ${cls(h.dayChangePct)}">${pct(h.dayChangePct)}</div>` },
    { key: 'value', label: `Value (${base})`, cls: 'num', render: (h) => money(h.value, base) },
    { key: 'weight', label: 'Weight', cls: 'num', render: (h) => `${pct(h.weight, { sign: false, digits: 1 })}<div class="bar"><i style="width:${(h.weight * 100).toFixed(1)}%"></i></div>` },
    { key: 'unrealized', label: 'Unrealized', cls: 'num', render: (h) => `<span class="${cls(h.unrealized)}">${money(h.unrealized, base, { sign: true })}</span><div class="small ${cls(h.unrealized)}">${pct(h.unrealizedPct)}</div>` },
    { key: 'dividends', label: 'Dividends', cls: 'num', render: (h) => money(h.dividends, base) },
    { key: 'totalReturn', label: 'Total return', cls: 'num', render: (h) => `<span class="${cls(h.totalReturn)}">${money(h.totalReturn, base, { sign: true })}</span>` },
  ], { sortKey: 'value', onRowClick: (h) => holdingModal(h, ctx) });

  table($('#cTable', el), r.closed, [
    { key: 'ticker', label: 'Asset', render: (h) => `<b>${esc(h.ticker)}</b> <span class="muted small">${esc(short(h.name, 30))}</span>` },
    { key: 'realized', label: 'Realized', cls: 'num', render: (h) => `<span class="${cls(h.realized)}">${money(h.realized, base, { sign: true })}</span>` },
    { key: 'dividends', label: 'Dividends', cls: 'num', render: (h) => money(h.dividends, base) },
    { key: 'totalReturn', label: 'Total', cls: 'num', render: (h) => `<span class="${cls(h.totalReturn)}">${money(h.totalReturn, base, { sign: true })}</span>` },
  ], { sortKey: 'totalReturn', onRowClick: (h) => holdingModal(h, ctx), empty: 'No closed positions.' });
}

function modal(title, bodyHtml, { wide = false } = {}) {
  const m = document.createElement('div');
  m.className = 'modal-bg';
  m.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div><div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  m.addEventListener('mousedown', (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); });
  return { el: $('.modal-body', m), close };
}

function holdingModal(h, ctx) {
  const { market, base } = ctx;
  const q = ctx.quotes[h.ticker] || {};
  const ty = trailingYield(market, h.ticker);
  const txs = ctx.txs.filter((t) => t.ticker === h.ticker).sort((a, b) => b.date.localeCompare(a.date));
  const { el } = modal(`${esc(h.ticker)} <span class="muted">${esc(h.name)}</span>`, `
    <div class="kpis compact">
      ${kpi('Price', money(h.price, h.currency), pct(h.dayChangePct), cls(h.dayChangePct))}
      ${kpi('Position', money(h.value, base), `${qty(h.qty)} sh · avg ${money(h.avgPrice, h.currency)}`)}
      ${kpi('Total return', `<span class="${cls(h.totalReturn)}">${money(h.totalReturn, base, { sign: true })}</span>`, `unrealized ${pct(h.unrealizedPct)}`)}
      ${kpi('Dividend yield', pct(ty.yield, { sign: false }), `TTM ${money(ty.dps, h.currency)}/sh`)}
    </div>
    <div class="facts">${[
      ['Sector', q.sector], ['Industry', q.industry], ['Country', q.country], ['Market', q.market], ['P/E', q.pe && num(q.pe, 1)],
      ['Fwd P/E', q.forward_pe && num(q.forward_pe, 1)], ['Market cap', q.market_cap && money(q.market_cap, h.currency, { compact: true })],
      ['52w range', q.low_52w ? `${num(q.low_52w)} – ${num(q.high_52w)}` : null], ['Beta', q.beta && num(q.beta, 2)],
    ].filter(([, v]) => v).map(([k, v]) => `<div><span class="muted">${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="card-head"><h3>Price</h3><div class="seg" id="hRange"></div></div>
    <div class="chart-box"><canvas id="hChart"></canvas></div>
    ${h.lots.length ? `<h3 class="mt">Open lots (FIFO)</h3><div id="lotsT"></div>` : ''}
    <h3 class="mt">Transactions</h3><div id="txT"></div>`, { wide: true });

  const s = market.prices[h.ticker] || new Series();
  segmented($('#hRange', el), RANGES, '1Y', (rg) => {
    const from = rangeStart(rg, txs.length ? txs[txs.length - 1].date : s.dates[0]);
    const s0 = Math.max(0, s.dates.findIndex((d) => d >= from));
    const idx = downsample(s.length - s0, 400).map((i) => i + s0);
    const labels = idx.map((i) => s.dates[i]);
    const marks = (type) => labels.map((d, k) => {
      const next = labels[k + 1] || '9999';
      const hit = txs.find((t) => t.type === type && t.date >= d && t.date < next);
      return hit ? hit.price : null;
    });
    chart($('#hChart', el), {
      type: 'line',
      data: { labels, datasets: [
        { label: h.ticker, data: idx.map((i) => s.values[i]), borderColor: cssVar('--accent'), pointRadius: 0, borderWidth: 1.8 },
        { label: 'Buy', data: marks('BUY'), showLine: false, pointRadius: 5, pointBackgroundColor: cssVar('--pos'), borderColor: cssVar('--pos') },
        { label: 'Sell', data: marks('SELL'), showLine: false, pointRadius: 5, pointBackgroundColor: cssVar('--neg'), borderColor: cssVar('--neg') },
      ] },
      options: lineOpts(h.currency),
    });
  });
  if (h.lots.length) {
    table($('#lotsT', el), h.lots, [
      { key: 'date', label: 'Bought', render: (l) => fmtDate(l.date) },
      { key: 'portfolioId', label: 'Portfolio', render: (l) => esc(ctx.portfolioName(l.portfolioId)) },
      { key: 'qty', label: 'Shares', cls: 'num', render: (l) => qty(l.qty) },
      { key: 'price', label: 'Price', cls: 'num', render: (l) => money(l.price, l.currency) },
      { key: 'gain', label: 'Gain', cls: 'num', sort: (l) => h.price / l.price, render: (l) => `<span class="${cls(h.price - l.price)}">${pct(h.price / l.price - 1)}</span>` },
    ], { sortKey: 'date', sortDir: 1 });
  }
  txTable($('#txT', el), txs, ctx, { compact: true });
}

// ======================================================================= transactions

function txTable(el, txs, ctx, { compact = false } = {}) {
  const cols = [
    { key: 'date', label: 'Date', render: (t) => fmtDate(t.date) },
    ...(compact || ctx.state.portfolios.length < 2 ? [] : [{ key: 'portfolioId', label: 'Portfolio', render: (t) => esc(ctx.portfolioName(t.portfolioId)) }]),
    { key: 'type', label: 'Type', render: (t) => `<span class="tag ${t.type.toLowerCase()}">${t.type}</span>` },
    { key: 'ticker', label: 'Ticker', render: (t) => `<b>${esc(t.ticker || '')}</b>` },
    { key: 'quantity', label: 'Qty', cls: 'num', render: (t) => (t.quantity ? qty(t.quantity) : '') },
    { key: 'price', label: 'Price', cls: 'num', render: (t) => (t.price ? money(t.price, t.currency) : '') },
    { key: 'total', label: 'Total', cls: 'num', sort: (t) => txTotal(t), render: (t) => money(txTotal(t), t.currency) + (t.settleCurrency ? `<div class="small muted">${money(t.settleAmount, t.settleCurrency)}</div>` : '') },
    { key: 'fee', label: 'Fee / tax', cls: 'num', sort: (t) => (t.fee || t.tax || 0), render: (t) => (t.fee || t.tax ? money(t.fee || t.tax, t.currency) : '') },
    ...(compact ? [] : [{ key: 'note', label: 'Note', render: (t) => `<span class="muted small">${esc(short(t.note || '', 30))}</span>` },
      { key: 'actions', label: '', render: (t) => `<button class="icon-btn" data-edit="${esc(t.id)}" title="Edit">✎</button><button class="icon-btn" data-del="${esc(t.id)}" title="Delete">🗑</button>` }]),
  ];
  table(el, txs, cols, { sortKey: 'date', empty: 'No transactions match.' });
  el.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) txForm(ctx, store.get().transactions.find((t) => t.id === ed.dataset.edit));
    if (del && confirm('Delete this transaction?')) store.deleteTransactions([del.dataset.del]);
  });
}

function txTotal(t) {
  if (t.type === 'BUY') return t.quantity * t.price + (t.fee || 0);
  if (t.type === 'SELL') return t.quantity * t.price - (t.fee || 0);
  if (t.type === 'DIVIDEND') return (t.amount || 0) - (t.tax || 0);
  return t.amount || 0;
}

export async function transactions(el, ctx) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  el.innerHTML = `
  <div class="card">
    <div class="card-head wrap">
      <h3>Transactions <span class="muted">(${ctx.txs.length})</span></h3>
      <div class="row gap wrap">
        <input type="search" id="txSearch" placeholder="Search ticker / note…" class="sm">
        <select id="txType" class="sm"><option value="">All types</option>${TX_TYPES.map((x) => `<option>${x}</option>`).join('')}</select>
        <button class="btn primary" id="addTx">+ Add</button>
        <button class="btn" id="impTx">Import CSV</button>
        <button class="btn" id="expTx">Export CSV</button>
      </div>
    </div>
    <div id="txList"></div>
  </div>`;
  const draw = () => {
    const q = $('#txSearch').value.trim().toLowerCase(), ty = $('#txType').value;
    const list = ctx.txs.filter((t) => (!ty || t.type === ty) && (!q || (t.ticker || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q)));
    const holder = $('#txList');
    const fresh = holder.cloneNode(false);
    holder.replaceWith(fresh);
    txTable(fresh, list, ctx);
  };
  $('#txSearch').addEventListener('input', draw);
  $('#txType').addEventListener('change', draw);
  $('#addTx').addEventListener('click', () => txForm(ctx));
  $('#impTx').addEventListener('click', () => importDialog(ctx));
  $('#expTx').addEventListener('click', () => download(`transactions-${todayISO()}.csv`, toCSV(ctx.txs, ctx.state.portfolios), 'text/csv'));
  draw();
  if (params.get('add')) { history.replaceState(null, '', '#/transactions'); txForm(ctx); }
  if (params.get('import')) { history.replaceState(null, '', '#/transactions'); importDialog(ctx); }
}

function txForm(ctx, tx = null) {
  const s = ctx.state;
  const known = [...new Set([...Object.keys(ctx.quotes), ...s.transactions.map((t) => t.ticker).filter(Boolean)])].sort();
  const pid = tx?.portfolioId || (ctx.selected !== 'all' ? ctx.selected : s.portfolios[0].id);
  const { el, close } = modal(tx ? 'Edit transaction' : 'Add transaction', `
    <form id="txf" class="form">
      <label>Type<select name="type">${TX_TYPES.map((x) => `<option ${x === (tx?.type || 'BUY') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Portfolio<select name="portfolioId">${s.portfolios.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Date<input type="date" name="date" required value="${tx?.date || todayISO()}" max="${todayISO()}"></label>
      <label data-f="ticker">Ticker<input name="ticker" list="tickerList" placeholder="e.g. AAPL, PKO.WA, SAP.DE" value="${esc(tx?.ticker || '')}" autocomplete="off"></label>
      <label data-f="quantity">Quantity<input type="number" step="any" min="0" name="quantity" value="${tx?.quantity ?? ''}"></label>
      <label data-f="price">Price per share<input type="number" step="any" min="0" name="price" value="${tx?.price ?? ''}"></label>
      <label data-f="fee">Fee / commission<input type="number" step="any" min="0" name="fee" value="${tx?.fee ?? ''}"></label>
      <label data-f="amount"><span data-amount-label>Amount</span><input type="number" step="any" min="0" name="amount" value="${tx?.amount ?? ''}"></label>
      <label data-f="tax">Tax withheld<input type="number" step="any" min="0" name="tax" value="${tx?.tax ?? ''}"></label>
      <label>Currency<input name="currency" maxlength="3" required value="${esc(tx?.currency || ctx.base)}" style="text-transform:uppercase"></label>
      <details class="full settle" data-f="settle" ${tx?.settleCurrency ? 'open' : ''}><summary class="small">Paid / received in another currency (e.g. PLN account buying USD shares)</summary>
        <div class="form">
          <label>Account currency<input name="settleCurrency" maxlength="3" placeholder="PLN" value="${esc(tx?.settleCurrency || '')}" style="text-transform:uppercase"></label>
          <label><span data-settle-label>Total charged</span><input type="number" step="any" min="0" name="settleAmount" value="${tx?.settleAmount ?? ''}"></label>
          <div class="full muted small" id="settleHint">The exact amount that left or reached your account, including fees and the broker's FX spread. Used for cost basis and cash.</div>
        </div>
      </details>
      <label class="full">Note<input name="note" value="${esc(tx?.note || '')}"></label>
      <datalist id="tickerList">${known.map((k) => `<option value="${esc(k)}">${esc(ctx.quotes[k]?.name || '')}</option>`).join('')}</datalist>
      <div class="full muted small" id="txHint"></div>
      <div class="full row gap end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${tx ? 'Save' : 'Add'}</button></div>
    </form>`);
  const f = $('#txf', el);
  const FIELDS_BY_TYPE = { BUY: ['ticker', 'quantity', 'price', 'fee', 'settle'], SELL: ['ticker', 'quantity', 'price', 'fee', 'settle'], DIVIDEND: ['ticker', 'amount', 'tax', 'settle'] };
  const sync = () => {
    const type = f.type.value;
    const show = FIELDS_BY_TYPE[type] || ['amount'];
    $$('[data-f]', f).forEach((l) => { l.hidden = !show.includes(l.dataset.f); });
    $('[data-amount-label]', f).textContent = type === 'DIVIDEND' ? 'Gross amount' : 'Amount';
    $('[data-settle-label]', f).textContent = type === 'BUY' ? 'Total charged' : 'Total received';
    const tk = f.ticker.value.trim().toUpperCase();
    const hint = [];
    if (show.includes('ticker') && tk) {
      const qd = ctx.quotes[tk];
      if (qd) hint.push(`${qd.name} · last ${money(qd.price, qd.currency)}`);
      else hint.push('⚠ No market data for this ticker yet — use Yahoo Finance symbols (e.g. PKO.WA). Add it to tickers.json to get prices.');
    }
    if (type === 'BUY' || type === 'SELL') {
      const tot = (+f.quantity.value || 0) * (+f.price.value || 0);
      if (tot) hint.push(`Total ${money(tot + (type === 'BUY' ? 1 : -1) * (+f.fee.value || 0), f.currency.value.toUpperCase() || ctx.base)}`);
    }
    const sa = +f.settleAmount.value, sc = f.settleCurrency.value.trim().toUpperCase();
    if (show.includes('settle') && sa && sc && sc !== f.currency.value.toUpperCase()) {
      const local = type === 'DIVIDEND' ? (+f.amount.value || 0) - (+f.tax.value || 0) : (+f.quantity.value || 0) * (+f.price.value || 0) + (type === 'BUY' ? 1 : -1) * (+f.fee.value || 0);
      if (local > 0) hint.push(`Effective rate ${num(sa / local, 4)} ${sc}/${f.currency.value.toUpperCase()}`);
    }
    $('#txHint', f).textContent = hint.join(' · ');
  };
  f.ticker.addEventListener('change', () => {
    const qd = ctx.quotes[f.ticker.value.trim().toUpperCase()];
    if (qd?.currency) f.currency.value = qd.currency;
    if (qd?.price && !f.price.value && f.type.value !== 'DIVIDEND') f.price.placeholder = qd.price;
    sync();
  });
  f.addEventListener('input', sync);
  sync();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const type = fd.type;
    const out = { id: tx?.id, portfolioId: fd.portfolioId, date: fd.date, type, currency: fd.currency.toUpperCase().trim() };
    if (fd.note) out.note = fd.note;
    const want = FIELDS_BY_TYPE[type] || ['amount'];
    for (const k of want) {
      if (k === 'ticker') { if (fd.ticker) out.ticker = fd.ticker.trim().toUpperCase(); continue; }
      if (k === 'settle') {
        const sc = (fd.settleCurrency || '').trim().toUpperCase();
        if (sc && sc !== out.currency && +fd.settleAmount > 0) { out.settleCurrency = sc; out.settleAmount = +fd.settleAmount; }
        continue;
      }
      if (fd[k] !== '' && fd[k] !== undefined) out[k] = +fd[k];
    }
    if ((type === 'BUY' || type === 'SELL') && (!out.ticker || !out.quantity || out.price === undefined)) return toast('Ticker, quantity and price are required', 'error');
    if (!want.includes('quantity') && !out.amount) return toast('Amount is required', 'error');
    if (type === 'SELL') {
      const held = ctx.state.transactions.filter((t) => t.portfolioId === out.portfolioId && t.ticker === out.ticker && t.id !== out.id && t.date <= out.date)
        .reduce((s2, t) => s2 + (t.type === 'BUY' ? t.quantity : t.type === 'SELL' ? -t.quantity : 0), 0);
      if (out.quantity > held + 1e-9 && !confirm(`You only hold about ${qty(held)} ${out.ticker} on that date (ignoring splits). Save anyway?`)) return;
    }
    store.upsertTransaction(out);
    toast(tx ? 'Transaction updated' : 'Transaction added');
    close();
  });
}

const SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

/** Read a CSV/TXT/XLSX file into candidate tables: [{ name, rows }] */
async function fileToTables(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    await loadScript(SHEETJS);
    const wb = window.XLSX.read(await file.arrayBuffer(), { cellDates: true });
    return wb.SheetNames.map((name) => ({ name,
      rows: window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss', defval: '' }).map((r) => r.map((c) => String(c ?? ''))) }));
  }
  const text = await readFile(file);
  const { headers, rows } = parseCSV(text);
  return [{ name: file.name, rows: [headers, ...rows], text }];
}

function importDialog(ctx) {
  const s = ctx.state;
  const pid = ctx.selected !== 'all' ? ctx.selected : s.portfolios[0].id;
  const { el, close } = modal('Import transactions', `
    <p class="muted small">Upload a broker statement — <b>XTB</b> (cash operations, xlsx or csv), <b>Degiro</b> (Transactions.csv and Account.csv),
    <b>Interactive Brokers</b> (activity statement csv) and <b>Revolut</b> are recognised automatically. Anything else (mBank, Bossa, your own sheet…)
    goes through the column mapper; Polish and English headers are detected.</p>
    <div class="row gap wrap"><input type="file" id="csvFile" accept=".csv,.txt,.xlsx,.xls,text/csv"><span class="muted">or paste CSV below</span></div>
    <textarea id="csvText" rows="4" placeholder="date,type,ticker,quantity,price,fee,currency&#10;2024-03-05,BUY,AAPL,10,170.5,1,USD"></textarea>
    <div id="detected"></div>
    <div class="form">
      <label>Into portfolio<select id="impPf">${s.portfolios.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Default / account currency<input id="impCcy" value="${esc(ctx.base)}" maxlength="3"></label>
      <label data-generic>Ticker suffix<input id="impSfx" placeholder=".WA"></label>
      <label data-generic>Default type<select id="impType"><option value="">(from column / sign)</option>${TX_TYPES.map((x) => `<option>${x}</option>`).join('')}</select></label>
      <label class="check" data-generic><input type="checkbox" id="impMonth"> Dates are month-first (US)</label>
      <label class="check"><input type="checkbox" id="impDup" checked> Skip duplicates</label>
    </div>
    <div id="mapBox"></div>
    <div id="symBox"></div>
    <div id="preview"></div>
    <div class="row gap end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="doImport" disabled>Import</button></div>`, { wide: true });

  const known = new Set([...Object.keys(ctx.quotes), ...(ctx.meta.tickers || []), ...s.transactions.map((t) => t.ticker).filter(Boolean)]);
  const isinNames = ctx.meta.isins || {};
  let tables = null, broker = null, table = null, mapping = {}, outcome = null, symMap = {}, checkToken = 0;

  const opts = () => ({ portfolioId: $('#impPf', el).value, currency: $('#impCcy', el).value.toUpperCase(), accountCurrency: null,
    tickerSuffix: $('#impSfx', el).value.trim(), type: $('#impType', el).value || null, monthFirst: $('#impMonth', el).checked,
    isinMap: { ...isinNames, ...Object.fromEntries(Object.entries(s.settings.symbolMap || {}).filter(([k]) => k.startsWith('ISIN:')).map(([k, v]) => [k.slice(5), v])) } });

  const setTables = (list) => {
    tables = list; broker = null; table = null;
    for (const t of list) { const b = detectBroker(t.rows); if (b) { broker = b; table = t; break; } }
    if (!table) table = list.find((t) => t.rows.length > 1) || list[0];
    mapping = broker ? {} : detectColumns(table.rows[0] || []);
    $('#detected', el).innerHTML = broker ? `<div class="alert info">Detected <b>${esc(BROKER_NAMES[broker])}</b>${list.length > 1 ? ` (sheet “${esc(table.name)}”)` : ''}. Columns are read automatically — beta: if something looks off, tell us what your file looks like.</div>` : '';
    $$('[data-generic]', el).forEach((x) => { x.hidden = !!broker; });
    drawMapping(); refresh();
  };

  const drawMapping = () => {
    if (broker || !table) { $('#mapBox', el).innerHTML = ''; return; }
    const headers = table.rows[0] || [];
    $('#mapBox', el).innerHTML = `<h4>Column mapping</h4><div class="form map">${FIELDS.map((f) => `<label>${f}<select data-map="${f}"><option value="">—</option>${headers.map((h, i) => `<option value="${i}" ${mapping[f] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>`;
    $$('[data-map]', el).forEach((sel) => sel.addEventListener('change', () => { mapping[sel.dataset.map] = sel.value === '' ? undefined : +sel.value; refresh(); }));
  };

  function parse() {
    const o = opts();
    if (broker) {
      const r = PARSERS[broker](table.rows, { portfolioId: o.portfolioId, isinMap: o.isinMap, accountCurrency: null });
      if (r.accountCurrency) $('#impCcy', el).value = r.accountCurrency;
      return r;
    }
    return { ...rowsToTransactions(table.rows.slice(1), mapping, o), notes: [] };
  }

  function refresh() {
    if (!table) { $('#preview', el).innerHTML = ''; $('#symBox', el).innerHTML = ''; $('#doImport', el).disabled = true; return; }
    outcome = parse();
    // symbol mapping: remembered map → anything unknown or unresolved ISINs
    const saved = s.settings.symbolMap || {};
    const symbols = [...new Set(outcome.transactions.map((t) => t.ticker).filter(Boolean))];
    for (const sym of symbols) if (!(sym in symMap)) symMap[sym] = saved[sym] || (sym.startsWith('ISIN:') ? '' : sym);
    const unknown = symbols.filter((sym) => sym.startsWith('ISIN:') || !known.has(symMap[sym] || sym) || saved[sym]);
    $('#symBox', el).innerHTML = unknown.length ? `<h4>Symbols <span class="muted small">— use Yahoo Finance tickers (AAPL, PKO.WA, VWCE.DE). Saved for future imports.</span></h4>
      <div class="sym-grid">${unknown.map((sym) => {
        const note = outcome.transactions.find((t) => t.ticker === sym)?.note || '';
        const ok = known.has(symMap[sym]);
        return `<label><span>${esc(sym)}${note ? ` <span class="muted small">${esc(short(note, 28))}</span>` : ''}</span>
          <input data-sym="${esc(sym)}" value="${esc(symMap[sym])}" placeholder="${sym.startsWith('ISIN:') ? 'ticker or keep ISIN' : ''}" class="sm"> ${ok ? '<span class="pos small">✓ has data</span>' : '<span class="muted small">no market data yet</span>'}</label>`;
      }).join('')}</div>
      ${unknown.some((x) => x.startsWith('ISIN:')) ? `<p class="muted small">Don’t know the ticker? Leave it empty and add the ISIN to <code>tickers.json</code> — the data workflow resolves ISINs automatically, then re-import.</p>` : ''}` : '';
    $$('[data-sym]', el).forEach((inp) => inp.addEventListener('change', () => { symMap[inp.dataset.sym] = inp.value.trim().toUpperCase(); refresh(); }));

    let txs = outcome.transactions.map((t) => (t.ticker && symMap[t.ticker] ? { ...t, ticker: symMap[t.ticker] } : { ...t }));
    let dups = 0;
    if ($('#impDup', el).checked) {
      const have = new Set(store.get().transactions.map(txFingerprint));
      txs = txs.filter((t) => (have.has(txFingerprint(t)) ? (dups++, false) : true));
    }
    outcome.final = txs;
    drawPreview(dups, []);
    sanityCheck(txs, dups);
  }

  function drawPreview(dups, issues) {
    const txs = outcome.final;
    const counts = TX_TYPES.map((ty) => [ty, txs.filter((t) => t.type === ty).length]).filter(([, c]) => c);
    $('#preview', el).innerHTML = `<p><b>${txs.length}</b> transactions ready${counts.length ? ` (${counts.map(([ty, c]) => `${c} ${ty.toLowerCase()}`).join(', ')})` : ''}${dups ? `, ${dups} duplicates skipped` : ''}${outcome.errors.length ? `, <span class="neg">${outcome.errors.length} rows skipped</span>` : ''}.</p>
      ${(outcome.notes || []).map((n) => `<div class="muted small">ℹ ${esc(n)}</div>`).join('')}
      ${issues.length ? `<div class="alert"><b>Price check:</b><ul>${issues.slice(0, 12).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${outcome.errors.length ? `<details><summary>Skipped rows</summary><ul class="small">${outcome.errors.slice(0, 50).map((e) => `<li>Row ${e.row}: ${esc(e.message)}</li>`).join('')}</ul></details>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Ticker</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Fee</th><th class="num">Amount</th><th>Ccy</th><th class="num">Settled</th></tr></thead><tbody>
      ${txs.slice(0, 10).map((t) => `<tr><td>${t.date}</td><td>${t.type}</td><td>${esc(t.ticker || '')}</td><td class="num">${t.quantity ?? ''}</td><td class="num">${t.price ?? ''}</td><td class="num">${t.fee || ''}</td><td class="num">${t.amount ?? ''}${t.tax ? ` <span class="muted small">tax ${num(t.tax, 2)}</span>` : ''}</td><td>${esc(t.currency)}</td><td class="num">${t.settleAmount ? `${t.settleAmount} ${t.settleCurrency}` : ''}</td></tr>`).join('')}
      </tbody></table></div>${txs.length > 10 ? `<p class="muted small">…and ${txs.length - 10} more</p>` : ''}`;
    $('#doImport', el).disabled = !txs.length;
  }

  // Compare trade prices with market closes: fixes pence-quoted LSE prices, flags likely mistakes.
  async function sanityCheck(txs, dups) {
    const token = ++checkToken;
    const tickers = [...new Set(txs.filter((t) => t.price && t.ticker && ctx.meta.files?.[t.ticker]).map((t) => t.ticker))];
    if (!tickers.length) return;
    const hist = await loadHistories(tickers);
    if (token !== checkToken) return;
    const issues = [];
    for (const t of txs) {
      const h = hist[t.ticker];
      if (!h || !t.price) continue;
      const s2 = new Series(h.dates, h.close);
      const px = s2.at(t.date);
      if (!px) continue;
      const ratio = t.price / px;
      if (ratio > 70 && ratio < 140) { t.price = r4(t.price / 100); if (t.fee) t.fee = r4(t.fee / 100); t.note = [t.note, 'price converted from pence'].filter(Boolean).join('; '); issues.push(`${t.date} ${t.ticker}: price looked like pence/cents — divided by 100.`); }
      else if (ratio > 2.5 || ratio < 0.4) issues.push(`${t.date} ${t.ticker}: price ${num(t.price, 4)} is far from the market close ${num(px, 4)} ${h.currency} — check the ticker or currency.`);
      else if (h.currency && t.currency !== h.currency && !t.settleCurrency) issues.push(`${t.ticker}: file says ${t.currency}, market data is in ${h.currency}.`);
    }
    drawPreview(dups, [...new Set(issues)]);
  }

  $('#csvFile', el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { const list = await fileToTables(file); $('#csvText', el).value = list[0].text || `(${file.name}: ${list.length} sheet(s))`; symMap = {}; setTables(list); }
    catch (err) { toast('Could not read file: ' + err.message, 'error'); }
  });
  $('#csvText', el).addEventListener('input', () => {
    const text = $('#csvText', el).value;
    if (!text.trim()) { tables = table = null; refresh(); return; }
    const { headers, rows } = parseCSV(text);
    setTables([{ name: 'pasted', rows: [headers, ...rows], text }]);
  });
  ['#impPf', '#impCcy', '#impSfx', '#impType', '#impMonth', '#impDup'].forEach((id) => $(id, el).addEventListener('change', refresh));
  $('#doImport', el).addEventListener('click', () => {
    const remember = Object.fromEntries(Object.entries(symMap).filter(([k, v]) => v && v !== k));
    if (Object.keys(remember).length) store.setSettings({ symbolMap: { ...(s.settings.symbolMap || {}), ...remember } });
    store.addTransactions(outcome.final);
    toast(`Imported ${outcome.final.length} transactions`);
    close();
  });
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ======================================================================= dividends

export async function dividends(el, ctx) {
  const { result: r, base, market } = ctx;
  if (!ctx.txs.length) return emptyState(el, ctx);
  const today = r.today;
  const year = today.slice(0, 4);
  const forecast = forecastDividends(r.holdings, market, base, today);
  const fwd = forecast.reduce((s, f) => s + f.amountBase, 0);
  const sum = (arr) => arr.reduce((s, d) => s + d.netBase, 0);
  const ytd = sum(r.dividends.filter((d) => d.date.startsWith(year)));
  const ttm = sum(r.dividends.filter((d) => d.date > addDays(today, -365)));
  const estimated = r.dividends.filter((d) => d.estimated).length;

  el.innerHTML = `
  <div class="kpis">
    ${kpi(`Received ${year}`, money(ytd, base))}
    ${kpi('Last 12 months', money(ttm, base))}
    ${kpi('Forecast next 12m', money(fwd, base), 'gross, from trailing payouts')}
    ${kpi('Portfolio yield', pct(r.totals.holdingsValue ? fwd / r.totals.holdingsValue : 0, { sign: false }), 'forward, on market value')}
    ${kpi('Yield on cost', pct(r.totals.costBasis ? fwd / r.totals.costBasis : 0, { sign: false }))}
    ${kpi('All-time received', money(r.totals.dividends, base))}
  </div>
  ${estimated ? `<div class="alert info">${estimated} payments are <b>estimated</b> from market data (ex-date × shares held, before tax) because you have not recorded dividends for those tickers. Record actual DIVIDEND transactions for exact numbers, or turn estimation off in Settings.</div>` : ''}
  <div class="card"><div class="card-head"><h3>Monthly dividends</h3><span class="muted small">last 24 months received + next 12 months forecast</span></div><div class="chart-box"><canvas id="divMonthly"></canvas></div></div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>By year</h3></div><div class="chart-box small"><canvas id="divYearly"></canvas></div></div>
    <div class="card"><div class="card-head"><h3>Upcoming (forecast)</h3></div><div id="fcList" class="scroll-list"></div></div>
  </div>
  <div class="card"><div class="card-head"><h3>By company</h3></div><div id="divByTicker"></div></div>
  <div class="card"><div class="card-head"><h3>Payments</h3></div><div id="divList"></div></div>`;

  // monthly chart
  const months = [];
  const start = new Date(today + 'T00:00:00Z'); start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - 23);
  for (let i = 0; i < 36; i++) { const d = new Date(start); d.setUTCMonth(d.getUTCMonth() + i); months.push(d.toISOString().slice(0, 7)); }
  const rec = Object.fromEntries(months.map((m) => [m, 0])), fc = Object.fromEntries(months.map((m) => [m, 0]));
  for (const d of r.dividends) if (d.date.slice(0, 7) in rec) rec[d.date.slice(0, 7)] += d.netBase;
  for (const f of forecast) if (f.date.slice(0, 7) in fc && f.date > today) fc[f.date.slice(0, 7)] += f.amountBase;
  chart($('#divMonthly'), {
    type: 'bar',
    data: { labels: months.map((m) => fmtDate(m + '-01', { month: 'short', year: '2-digit' })), datasets: [
      { label: 'Received', data: months.map((m) => rec[m] || null), backgroundColor: cssVar('--pos') },
      { label: 'Forecast', data: months.map((m) => fc[m] || null), backgroundColor: cssVar('--accent-soft2'), borderColor: cssVar('--accent'), borderWidth: 1 },
    ] },
    options: barOpts(base, true),
  });
  const byYear = {};
  for (const d of r.dividends) byYear[d.date.slice(0, 4)] = (byYear[d.date.slice(0, 4)] || 0) + d.netBase;
  const ys = Object.keys(byYear).sort();
  chart($('#divYearly'), { type: 'bar', data: { labels: ys, datasets: [{ label: 'Net dividends', data: ys.map((y) => byYear[y]), backgroundColor: cssVar('--pos') }] }, options: barOpts(base) });

  $('#fcList').innerHTML = forecast.filter((f) => f.date > today).slice(0, 30).map((f) => `<div class="mini-row"><span><b>${esc(f.ticker)}</b> <span class="muted small">${fmtDate(f.date)}</span></span><span>${money(f.amountBase, base)} <span class="muted small">${num(f.dps, 4)} ${f.currency}/sh</span></span></div>`).join('') || '<div class="muted">No dividend payers in the portfolio.</div>';

  const rows = new Map();
  for (const h of [...r.holdings, ...r.closed]) rows.set(h.ticker, { ticker: h.ticker, name: h.name, received: 0, ttm: 0, fwd: 0, value: h.value, cost: h.costBase, qty: h.qty });
  for (const d of r.dividends) {
    const row = rows.get(d.ticker); if (!row) continue;
    row.received += d.netBase; if (d.date > addDays(today, -365)) row.ttm += d.netBase;
  }
  for (const f of forecast) rows.get(f.ticker).fwd += f.amountBase;
  table($('#divByTicker'), [...rows.values()].filter((x) => x.received || x.fwd), [
    { key: 'ticker', label: 'Company', render: (x) => `<b>${esc(x.ticker)}</b> <span class="muted small">${esc(short(x.name, 28))}</span>` },
    { key: 'received', label: 'Received (all)', cls: 'num', render: (x) => money(x.received, base) },
    { key: 'ttm', label: 'Last 12m', cls: 'num', render: (x) => money(x.ttm, base) },
    { key: 'fwd', label: 'Next 12m', cls: 'num', render: (x) => money(x.fwd, base) },
    { key: 'yield', label: 'Yield', cls: 'num', sort: (x) => (x.value ? x.fwd / x.value : 0), render: (x) => pct(x.value ? x.fwd / x.value : 0, { sign: false }) },
    { key: 'yoc', label: 'Yield on cost', cls: 'num', sort: (x) => (x.cost ? x.fwd / x.cost : 0), render: (x) => pct(x.cost ? x.fwd / x.cost : 0, { sign: false }) },
  ], { sortKey: 'fwd', empty: 'No dividends yet.' });

  const allPays = [...r.dividends].reverse();
  const drawPays = (limit) => table($('#divList'), allPays.slice(0, limit), [
    { key: 'date', label: 'Date', render: (d) => fmtDate(d.date) },
    { key: 'ticker', label: 'Ticker', render: (d) => `<b>${esc(d.ticker || '')}</b>${d.estimated ? ' <span class="tag warn">est.</span>' : ''}` },
    { key: 'gross', label: 'Gross', cls: 'num', render: (d) => money(d.gross, d.currency) },
    { key: 'tax', label: 'Tax', cls: 'num', render: (d) => money(d.tax, d.currency) },
    { key: 'netBase', label: `Net (${base})`, cls: 'num', render: (d) => money(d.netBase, base) },
  ], { sortKey: 'date', empty: 'No dividends yet.' });
  drawPays(25);
  if (allPays.length > 25) {
    const more = document.createElement('button');
    more.className = 'btn mt';
    more.textContent = `Show all ${allPays.length} payments`;
    more.addEventListener('click', () => { drawPays(Infinity); more.remove(); });
    $('#divList').after(more);
  }
}

function barOpts(base, stacked = false) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: stacked, labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y, base)}` } } },
    scales: { x: { stacked, grid: { display: false } }, y: { stacked, ticks: { callback: (v) => money(v, base, { compact: true }) } } },
  };
}

// ======================================================================= analysis

export async function analysis(el, ctx) {
  const { result: r, base, market, quotes } = ctx;
  if (!ctx.txs.length) return emptyState(el, ctx);
  const H = [...r.holdings];
  const withCash = r.totals.cashValue > 0 ? [...H, { ticker: 'Cash', value: r.totals.cashValue, cash: true }] : H;
  const q = (h, k) => (h.cash ? 'Cash' : quotes[h.ticker]?.[k]);
  const groups = [
    ['Sector', groupBy(withCash, (h) => q(h, 'sector') || (quotes[h.ticker]?.quote_type === 'ETF' ? 'ETF / Fund' : null))],
    ['Country', groupBy(withCash, (h) => q(h, 'country'))],
    ['Currency', groupBy(withCash, (h) => (h.cash ? 'Cash' : h.currency))],
    ['Market', groupBy(withCash, (h) => q(h, 'market'))],
    ['Asset type', groupBy(withCash, (h) => (h.cash ? 'Cash' : ({ EQUITY: 'Stocks', ETF: 'ETFs', MUTUALFUND: 'Funds', CRYPTOCURRENCY: 'Crypto' }[quotes[h.ticker]?.quote_type] || 'Other')))],
  ];
  if (ctx.selected === 'all' && ctx.state.portfolios.length > 1) {
    const per = ctx.state.portfolios.map((p) => {
      const val = r.holdings.reduce((s, h) => s + h.lots.filter((l) => l.portfolioId === p.id).reduce((a, l) => a + l.qty, 0) * (h.qty ? h.value / h.qty : 0), 0);
      return { ticker: p.name, value: val };
    }).filter((x) => x.value > 0);
    groups.push(['Portfolio', groupBy(per, (h) => h.ticker)]);
  }

  // risk & yearly stats from daily TWR index
  const { dates, twr, value } = r.series;
  const rets = [];
  for (let i = 1; i < twr.length; i++) if (twr[i - 1] > 0 && twr[i] !== twr[i - 1]) rets.push(twr[i] / twr[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1)) * Math.sqrt(252);
  let peak = 0, mdd = 0, mddDate = null;
  for (let i = 0; i < twr.length; i++) { peak = Math.max(peak, twr[i]); const dd = twr[i] / peak - 1; if (dd < mdd) { mdd = dd; mddDate = dates[i]; } }
  const years = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365.25 * 864e5);
  const cagr = years > 0.5 ? Math.pow(twr[twr.length - 1], 1 / years) - 1 : null;

  el.innerHTML = `
  <div class="kpis">
    ${kpi('Annualised TWR', pct(cagr), `over ${num(years, 1)} years`)}
    ${kpi('Volatility', pct(vol, { sign: false }), 'annualised, daily returns')}
    ${kpi('Max drawdown', `<span class="neg">${pct(mdd)}</span>`, mddDate ? `trough ${fmtDate(mddDate)}` : '')}
    ${kpi('Sharpe (rf=0)', cagr !== null && vol ? num(cagr / vol, 2) : '—')}
    ${kpi('Positions', String(H.length), `top 3 = ${pct(H.slice(0, 3).reduce((s, h) => s + h.weight, 0), { sign: false, digits: 0 })}`)}
  </div>
  <div class="grid-3" id="allocGrid">${groups.map(([title], i) => `<div class="card"><div class="card-head"><h3>${title}</h3></div><div class="chart-box small"><canvas id="al${i}"></canvas></div><div id="all${i}" class="legend-list"></div></div>`).join('')}</div>
  <div class="card"><div class="card-head"><h3>Actual vs “same money into a benchmark”</h3><select id="simSel" class="sm"></select></div>
    <p class="muted small">Every contribution and withdrawal you made is replayed into the benchmark (converted to ${base}).</p>
    <div class="chart-box"><canvas id="simChart"></canvas></div></div>
  <div class="card"><div class="card-head"><h3>Returns by year</h3></div><div id="yearT"></div></div>
  <div class="card"><div class="card-head"><h3>Monthly returns (TWR)</h3></div><div id="heat" class="heat"></div></div>`;

  groups.forEach(([, g], i) => doughnut($(`#al${i}`), $(`#all${i}`), g.slice(0, 10), base));

  const benches = ctx.benchmarks.filter((b) => market.prices[b]?.length);
  const sel = $('#simSel');
  sel.innerHTML = benches.map((b) => `<option value="${esc(b)}">${esc(ctx.meta.benchmarks[b] || b)}</option>`).join('');
  const drawSim = () => {
    if (!sel.value) return;
    const b = benchmarkSeries(r.series, market, sel.value, base);
    const idx = downsample(dates.length, 400);
    chart($('#simChart'), { type: 'line', data: { labels: idx.map((i) => dates[i]), datasets: [
      { label: 'Your portfolio', data: idx.map((i) => value[i]), borderColor: cssVar('--accent'), pointRadius: 0, borderWidth: 2 },
      { label: ctx.meta.benchmarks[sel.value] || sel.value, data: idx.map((i) => b.simulated[i]), borderColor: PALETTE[2], pointRadius: 0, borderWidth: 1.5 },
      { label: 'Net invested', data: idx.map((i) => r.series.invested[i]), borderColor: cssVar('--muted'), borderDash: [4, 4], pointRadius: 0, borderWidth: 1, stepped: true },
    ] }, options: lineOpts(base) });
  };
  sel.addEventListener('change', drawSim);
  drawSim();

  // yearly table
  const firstYear = +dates[0].slice(0, 4), lastYear = +dates[dates.length - 1].slice(0, 4);
  const yrows = [];
  for (let y = lastYear; y >= firstYear; y--) {
    const p = periodStats(r.series, `${y - 1}-12-31`, `${y}-12-31`);
    const row = { year: String(y), profit: p.profit, twr: p.twr, endValue: p.endValue };
    for (const bt of benches) {
      const s = market.prices[bt];
      const ccy = market.currency(bt);
      const a = s.at(`${y - 1}-12-31`) ?? s.values[0], z = s.at(`${y}-12-31`);
      const fa = market.fxRate(ccy, base, `${y - 1}-12-31`) ?? 1, fz = market.fxRate(ccy, base, `${y}-12-31`) ?? 1;
      row[bt] = a && z && s.dates[0] <= `${y}-01-15` ? (z * fz) / (a * fa) - 1 : null;
    }
    yrows.push(row);
  }
  table($('#yearT'), yrows, [
    { key: 'year', label: 'Year' },
    { key: 'endValue', label: 'End value', cls: 'num', render: (x) => money(x.endValue, base) },
    { key: 'profit', label: 'Profit', cls: 'num', render: (x) => `<span class="${cls(x.profit)}">${money(x.profit, base, { sign: true })}</span>` },
    { key: 'twr', label: 'Return', cls: 'num', render: (x) => `<b class="${cls(x.twr)}">${pct(x.twr)}</b>` },
    ...benches.map((bt) => ({ key: bt, label: ctx.meta.benchmarks[bt] || bt, cls: 'num', render: (x) => `<span class="${cls(x[bt])}">${pct(x[bt])}</span>` })),
  ], { sortKey: 'year' });

  // monthly heatmap
  const monthIdx = new Map();
  for (let i = 0; i < dates.length; i++) monthIdx.set(dates[i].slice(0, 7), i);
  const ms = [...monthIdx.keys()];
  const mret = {};
  ms.forEach((m, k) => { const i = monthIdx.get(m); const prev = k ? twr[monthIdx.get(ms[k - 1])] : 1; mret[m] = twr[i] / prev - 1; });
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let hh = `<table><thead><tr><th>Year</th>${MN.map((m) => `<th>${m}</th>`).join('')}<th>Year</th></tr></thead><tbody>`;
  for (let y = lastYear; y >= firstYear; y--) {
    hh += `<tr><td><b>${y}</b></td>`;
    for (let m = 1; m <= 12; m++) {
      const v = mret[`${y}-${String(m).padStart(2, '0')}`];
      const a = v === undefined ? 0 : Math.min(1, Math.abs(v) / 0.08);
      hh += `<td style="background:${v === undefined ? 'transparent' : v >= 0 ? `rgba(16,185,129,${0.12 + a * 0.6})` : `rgba(239,68,68,${0.12 + a * 0.6})`}">${v === undefined ? '' : num(v * 100, 1)}</td>`;
    }
    const yr = yrows.find((x) => x.year === String(y));
    hh += `<td><b class="${cls(yr?.twr)}">${yr ? num(yr.twr * 100, 1) : ''}</b></td></tr>`;
  }
  $('#heat').innerHTML = `<div class="table-wrap">${hh}</tbody></table></div>`;
}

// ======================================================================= calendar

export async function calendar(el, ctx) {
  const { events } = await loadEvents();
  const held = new Set(ctx.result.holdings.map((h) => h.ticker));
  const forecast = forecastDividends(ctx.result.holdings, ctx.market, ctx.base).filter((f) => f.date > todayISO())
    .map((f) => ({ ticker: f.ticker, type: 'forecast', date: f.date, title: `${f.ticker} — expected dividend ≈ ${money(f.amountBase, ctx.base)}`, details: { per_share: `${num(f.dps, 4)} ${f.currency}`, estimated_total: money(f.amountBase, ctx.base), basis: 'same payment as a year ago' } }));
  const all = [...events, ...forecast];
  const filters = { earnings: true, dividend: true, split: true, forecast: true, mine: held.size > 0 };
  el.innerHTML = `
  <div class="grid-cal">
    <div class="card">
      <div class="row gap wrap filters">
        ${['earnings', 'dividend', 'split', 'forecast'].map((t) => `<label class="check"><input type="checkbox" data-t="${t}" checked> <span class="tag ${t}">${t === 'forecast' ? 'expected dividend' : t}</span></label>`).join('')}
        <label class="check"><input type="checkbox" data-t="mine" ${filters.mine ? 'checked' : ''}> Only my holdings</label>
      </div>
      <div id="cal"></div>
    </div>
    <div class="card side">
      <div class="card-head"><h3>Next 14 days</h3></div><div id="up14" class="upcoming"></div>
      <div id="evDetail" class="ev-detail"></div>
    </div>
  </div>`;
  let cal;
  const visible = () => all.filter((e) => filters[e.type] && (!filters.mine || held.has(e.ticker)));
  const draw = () => {
    const ev = visible();
    if (cal) cal.destroy();
    if (!window.FullCalendar) { $('#cal').innerHTML = '<p class="muted">Calendar library failed to load.</p>'; return; }
    cal = new window.FullCalendar.Calendar($('#cal'), {
      initialView: 'dayGridMonth', height: 'auto', firstDay: 1,
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
      events: ev.map((e, i) => ({ id: String(i), title: e.ticker, start: e.date, allDay: true, classNames: ['ev-' + e.type], extendedProps: e })),
      eventClick: (info) => {
        const e = info.event.extendedProps;
        $('#evDetail').innerHTML = `<h4>${esc(e.title)}</h4><div class="muted">${fmtDate(e.date)} · ${esc(e.market || '')}</div>` +
          Object.entries(e.details || {}).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => `<div class="mini-row"><span class="muted">${esc(k.replace(/_/g, ' '))}</span><b>${esc(v)}</b></div>`).join('');
      },
    });
    cal.render();
    const t = todayISO(), u = addDays(t, 14);
    const up = ev.filter((e) => e.date >= t && e.date <= u).sort((a, b) => a.date.localeCompare(b.date));
    $('#up14').innerHTML = up.map((e) => `<div class="mini-row"><span><span class="tag ${e.type}">${e.type === 'forecast' ? 'exp. div' : e.type}</span> <b>${esc(e.ticker)}</b></span><span class="muted">${fmtDate(e.date, { month: 'short', day: 'numeric' })}</span></div>`).join('') || '<div class="muted">Nothing scheduled.</div>';
  };
  $$('[data-t]', el).forEach((cb) => cb.addEventListener('change', () => { filters[cb.dataset.t] = cb.checked; draw(); }));
  draw();
}

// ======================================================================= taxes

export async function taxes(el, ctx) {
  if (!ctx.state.transactions.length) return emptyState(el, ctx);
  const tickers = [...new Set(ctx.state.transactions.filter((t) => t.ticker).map((t) => t.ticker))];
  const market = await buildMarket(tickers, { withNbp: true, manualPrices: ctx.settings.manualPrices });
  const txs = ctx.selected === 'all' ? ctx.state.transactions : ctx.txs;
  const tax = computePolishTax(txs, market);
  if (!tax.years.length) {
    el.innerHTML = '<div class="card"><h3>No taxable events yet</h3><p class="muted">Sales and recorded dividends will show up here.</p></div>';
    return;
  }
  const pick = new URLSearchParams(location.hash.split('?')[1] || '').get('y') || tax.years[0].year;
  const y = tax.years.find((x) => x.year === pick) || tax.years[0];
  const P = (v) => money(v, 'PLN');
  el.innerHTML = `
  <div class="alert info">Estimate of the Polish <b>PIT-38</b> using FIFO per portfolio (treat each portfolio as one broker account) and NBP mid rates from the business day before each transaction.
    Not tax advice — check against your broker's PIT-8C. Prior-year losses (up to 50% per year for 5 years) are not deducted automatically.</div>
  ${tax.warnings.length ? `<div class="alert"><ul>${tax.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
  <div class="card"><div class="card-head"><h3>Tax year</h3><div class="seg" id="yearSeg">${tax.years.map((x) => `<button class="${x.year === y.year ? 'on' : ''}" data-y="${x.year}">${x.year}</button>`).join('')}</div></div>
    <div class="kpis">
      ${kpi('Przychód (revenue)', P(y.proceeds), 'PIT-38 sec. C, field 22')}
      ${kpi('Koszty (costs)', P(y.costs), 'field 23')}
      ${kpi(y.income >= 0 ? 'Dochód (income)' : 'Strata (loss)', `<span class="${cls(y.income)}">${P(y.income)}</span>`, y.income >= 0 ? 'field 24' : 'field 25 — carry forward')}
      ${kpi('Podatek 19% (tax)', `<b>${P(y.tax)}</b>`, `base ${P(y.taxBase)} rounded`)}
      ${kpi('Foreign dividends: tax to pay', `<b>${P(y.divToPayRounded)}</b>`, `sec. G · gross ${P(y.divGross)}, withheld ${P(y.divWithheld)}`)}
      ${kpi('Total due', `<b>${P(y.tax + y.divToPayRounded)}</b>`)}
    </div>
  </div>
  <div class="card"><div class="card-head"><h3>Sales (${y.trades.length})</h3></div><div id="taxTrades"></div></div>
  <div class="card"><div class="card-head"><h3>Dividends (${y.dividends.length})</h3></div><div id="taxDivs"></div></div>`;
  $('#yearSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (b) { history.replaceState(null, '', `#/taxes?y=${b.dataset.y}`); taxes(el, ctx); } });
  table($('#taxTrades'), y.trades, [
    { key: 'date', label: 'Sold', render: (t) => fmtDate(t.date) },
    { key: 'ticker', label: 'Ticker', render: (t) => `<b>${esc(t.ticker)}</b>` },
    { key: 'qty', label: 'Qty', cls: 'num', render: (t) => qty(t.qty) },
    { key: 'rate', label: 'NBP rate', cls: 'num', render: (t) => (t.currency === 'PLN' ? '—' : `${num(t.rate, 4)} ${t.currency}`) },
    { key: 'buys', label: 'Bought (FIFO)', render: (t) => `<span class="small muted">${t.buys.map((b) => `${qty(b.qty)} @ ${num(b.price, 4)} on ${b.date}${t.currency !== 'PLN' ? ` (×${num(b.rate, 4)})` : ''}`).join('<br>')}</span>` },
    { key: 'proceeds', label: 'Revenue', cls: 'num', render: (t) => P(t.proceeds) },
    { key: 'costs', label: 'Costs', cls: 'num', render: (t) => P(t.costs) },
    { key: 'income', label: 'Income', cls: 'num', render: (t) => `<span class="${cls(t.income)}">${P(t.income)}</span>` },
  ], { sortKey: 'date', sortDir: 1, empty: 'No sales this year.' });
  table($('#taxDivs'), y.dividends, [
    { key: 'date', label: 'Date', render: (d) => fmtDate(d.date) },
    { key: 'ticker', label: 'Ticker', render: (d) => `<b>${esc(d.ticker || '')}</b>${d.domestic ? ' <span class="tag">PL — taxed at source</span>' : ''}` },
    { key: 'rate', label: 'NBP rate', cls: 'num', render: (d) => (d.domestic ? '—' : `${num(d.rate, 4)} ${d.currency}`) },
    { key: 'gross', label: 'Gross', cls: 'num', render: (d) => P(d.gross) },
    { key: 'withheld', label: 'Withheld', cls: 'num', render: (d) => P(d.withheld) },
    { key: 'toPay', label: 'To pay in PL', cls: 'num', render: (d) => P(d.toPay) },
  ], { sortKey: 'date', sortDir: 1, empty: 'No recorded dividends this year (estimated dividends are not used for tax).' });
}

// ======================================================================= watchlist

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
    { key: 'ticker', label: 'Ticker', render: (x) => `<b>${esc(x.ticker)}</b>${x.held ? ' <span class="tag">held</span>' : ''}${x.noData ? ' <span class="tag warn">no data</span>' : ''}<div class="muted small">${esc(short(x.name, 28))}</div>` },
    { key: 'price', label: 'Price', cls: 'num', render: (x) => money(x.price, x.currency) },
    { key: 'day', label: 'Day', cls: 'num', render: (x) => `<span class="${cls(x.day)}">${pct(x.day)}</span>` },
    { key: 'm1', label: '1M', cls: 'num', render: (x) => `<span class="${cls(x.m1)}">${pct(x.m1)}</span>` },
    { key: 'y1', label: '1Y', cls: 'num', render: (x) => `<span class="${cls(x.y1)}">${pct(x.y1)}</span>` },
    { key: 'range', label: '52w range', sort: (x) => (x.hi > x.lo ? (x.price - x.lo) / (x.hi - x.lo) : 0), render: (x) => (x.hi > x.lo ? `<div class="range"><i style="left:${Math.max(0, Math.min(100, ((x.price - x.lo) / (x.hi - x.lo)) * 100)).toFixed(0)}%"></i></div><div class="small muted">${num(x.lo)} – ${num(x.hi)}</div>` : '—') },
    { key: 'pe', label: 'P/E', cls: 'num', render: (x) => (x.pe ? num(x.pe, 1) : '—') },
    { key: 'yield', label: 'Div. yield', cls: 'num', render: (x) => (x.yield ? pct(x.yield, { sign: false }) : '—') },
    { key: 'next', label: 'Next event', sort: (x) => x.next?.date || '9999', render: (x) => (x.next ? `<span class="tag ${x.next.type}">${x.next.type}</span> <span class="small">${fmtDate(x.next.date, { month: 'short', day: 'numeric' })}</span>` : '') },
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
  });
}

// ======================================================================= settings

export async function settings(el, ctx) {
  const s = ctx.state;
  const st = s.settings;
  const bare = (t) => t.replace(/^ISIN:/, ''); // tickers.json accepts ISINs; the workflow resolves them
  const wanted = [...new Set([...(ctx.meta.tickers || []), ...Object.keys(ctx.meta.isins || {}), ...ctx.missing.map(bare), ...(st.watchlist || []).filter((t) => !ctx.meta.files?.[t])])].sort();
  const needsAdding = wanted.filter((t) => !(ctx.meta.tickers || []).includes(t) && !(ctx.meta.isins || {})[t]);
  el.innerHTML = `
  <div class="grid-2">
    <div class="card">
      <h3>General</h3>
      <div class="form">
        <label>Base currency<select id="sBase">${['USD', ...Object.keys(ctx.fx)].sort().map((c) => `<option ${c === ctx.base ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="check full"><input type="checkbox" id="sAuto" ${st.autoDividends ? 'checked' : ''}> Estimate dividends from market data for tickers without recorded dividends</label>
      </div>
      <h3 class="mt">Portfolios</h3>
      <div id="pfList"></div>
      <form id="pfAdd" class="row gap mt"><input name="n" placeholder="New portfolio name (e.g. IKE, XTB, mBank)" required class="grow"><button class="btn">Add</button></form>
    </div>
    <div class="card">
      <h3>Backup &amp; data</h3>
      <p class="muted small">Everything you enter is stored only in this browser (localStorage). Export a backup regularly — clearing browser data deletes it. Import the file on another device to sync.</p>
      <div class="row gap wrap">
        <button class="btn primary" id="bExp">Export backup (JSON)</button>
        <label class="btn">Import backup<input type="file" id="bImp" accept=".json,application/json" hidden></label>
        <label class="check"><input type="checkbox" id="bMerge"> merge instead of replace</label>
      </div>
      <div class="row gap wrap mt">
        <button class="btn" id="bDemo">Load demo portfolio</button>
        <button class="btn danger" id="bReset">Erase all data</button>
      </div>
      <p class="muted small mt">${s.transactions.length} transactions in ${s.portfolios.length} portfolio(s).</p>
    </div>
  </div>
  <div class="card">
    <h3>Market data</h3>
    <p class="muted small">Prices, FX and events come from Yahoo Finance and NBP via a GitHub Action that runs daily and commits JSON into <code>docs/data</code>.
      Last update: <b>${ctx.meta.generated_at ? new Date(ctx.meta.generated_at).toLocaleString() : 'never'}</b>. Tracked: ${(ctx.meta.tickers || []).length} tickers.</p>
    ${needsAdding.length ? `<div class="alert">These tickers need market data: <b>${needsAdding.map(esc).join(', ')}</b>. Replace <code>tickers.json</code> with the list below, then run the workflow.</div>` : '<p class="pos">All your tickers are tracked. ✓</p>'}
    <textarea readonly rows="4" id="tjson">${esc(JSON.stringify(wanted, null, 4))}</textarea>
    <div class="row gap wrap">
      <button class="btn" id="copyT">Copy tickers.json</button>
      <a class="btn" target="_blank" rel="noopener" href="${ctx.repoUrl}/edit/main/tickers.json">Edit tickers.json on GitHub</a>
      <a class="btn" target="_blank" rel="noopener" href="${ctx.repoUrl}/actions/workflows/deploy.yml">Run data refresh</a>
    </div>
  </div>
  <div class="card">
    <h3>Manual prices</h3>
    <p class="muted small">For assets without Yahoo data (bonds, private funds, delisted stocks). Used whenever no market price exists.</p>
    <div id="mpList"></div>
    <form id="mpAdd" class="row gap wrap mt"><input name="t" placeholder="Ticker" required class="sm"><input name="p" type="number" step="any" placeholder="Price" required class="sm"><input name="c" placeholder="Currency" maxlength="3" value="${esc(ctx.base)}" class="sm" required><button class="btn">Save</button></form>
  </div>`;

  $('#sBase').addEventListener('change', (e) => store.setSettings({ baseCurrency: e.target.value }));
  $('#sAuto').addEventListener('change', (e) => store.setSettings({ autoDividends: e.target.checked }));
  $('#pfList').innerHTML = s.portfolios.map((p) => `<div class="mini-row"><span><b>${esc(p.name)}</b> <span class="muted small">${s.transactions.filter((t) => t.portfolioId === p.id).length} tx</span></span>
    <span><button class="icon-btn" data-ren="${esc(p.id)}" title="Rename">✎</button>${s.portfolios.length > 1 ? `<button class="icon-btn" data-delp="${esc(p.id)}" title="Delete">🗑</button>` : ''}</span></div>`).join('');
  $('#pfList').addEventListener('click', (e) => {
    const r = e.target.closest('[data-ren]'), d = e.target.closest('[data-delp]');
    if (r) { const n = prompt('New name', ctx.portfolioName(r.dataset.ren)); if (n) store.renamePortfolio(r.dataset.ren, n.trim()); }
    if (d && confirm(`Delete portfolio "${ctx.portfolioName(d.dataset.delp)}" and all its transactions?`)) store.deletePortfolio(d.dataset.delp);
  });
  $('#pfAdd').addEventListener('submit', (e) => { e.preventDefault(); store.addPortfolio(e.target.n.value.trim()); toast('Portfolio added'); });
  $('#bExp').addEventListener('click', () => download(`portfolio-backup-${todayISO()}.json`, store.exportJSON(), 'application/json'));
  $('#bImp').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const merge = $('#bMerge').checked;
      if (!merge && s.transactions.length && !confirm('Replace all current data with this backup?')) return;
      store.importJSON(await readFile(f), { merge });
      toast('Backup imported');
    } catch (err) { toast('Import failed: ' + err.message, 'error'); }
  });
  $('#bDemo').addEventListener('click', loadDemo);
  $('#bReset').addEventListener('click', () => { if (confirm('Erase all portfolios and transactions from this browser? Export a backup first!')) { store.reset(); toast('All data erased'); } });
  $('#copyT').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#tjson').value); toast('Copied'); } catch { $('#tjson').select(); } });
  const mp = st.manualPrices || {};
  $('#mpList').innerHTML = Object.entries(mp).map(([t, v]) => `<div class="mini-row"><span><b>${esc(t)}</b></span><span>${money(v.price, v.currency)} <button class="icon-btn" data-rmp="${esc(t)}">✕</button></span></div>`).join('') || '<div class="muted small">None.</div>';
  $('#mpList').addEventListener('click', (e) => { const b = e.target.closest('[data-rmp]'); if (b) { const m = { ...mp }; delete m[b.dataset.rmp]; store.setSettings({ manualPrices: m }); } });
  $('#mpAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    store.setSettings({ manualPrices: { ...mp, [f.t.value.trim().toUpperCase()]: { price: +f.p.value, currency: f.c.value.trim().toUpperCase() } } });
  });
}
