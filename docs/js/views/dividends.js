// dividends page — split from the former views.js
import { addDays, forecastDividends } from '../engine.js';
import { t as tr } from '../i18n.js';
import { $, esc, money, num, pct, fmtDate, kpi, table, chart, cssVar } from '../ui.js';
import { barOpts, emptyState, short } from './common.js';
import { transactions } from './transactions.js';


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
      { label: tr('Received'), data: months.map((m) => rec[m] || null), backgroundColor: cssVar('--pos') },
      { label: tr('Forecast'), data: months.map((m) => fc[m] || null), backgroundColor: cssVar('--accent-soft2'), borderColor: cssVar('--accent'), borderWidth: 1 },
    ] },
    options: barOpts(base, true),
  });
  const byYear = {};
  for (const d of r.dividends) byYear[d.date.slice(0, 4)] = (byYear[d.date.slice(0, 4)] || 0) + d.netBase;
  const ys = Object.keys(byYear).sort();
  chart($('#divYearly'), { type: 'bar', data: { labels: ys, datasets: [{ label: tr('Net dividends'), data: ys.map((y) => byYear[y]), backgroundColor: cssVar('--pos') }] }, options: barOpts(base) });

  $('#fcList').innerHTML = forecast.filter((f) => f.date > today).slice(0, 30).map((f) => `<div class="mini-row"><span><b>${esc(f.ticker)}</b> <span class="muted small">${fmtDate(f.date)}</span></span><span>${money(f.amountBase, base)} <span class="muted small">${num(f.dps, 4)} ${f.currency}/sh</span></span></div>`).join('') || '<div class="muted">No dividend payers in the portfolio.</div>';

  const rows = new Map();
  for (const h of [...r.holdings, ...r.closed]) rows.set(h.ticker, { ticker: h.ticker, name: h.name, received: 0, ttm: 0, fwd: 0, value: h.value, cost: h.costBase, qty: h.qty });
  for (const d of r.dividends) {
    const row = rows.get(d.ticker); if (!row) continue;
    row.received += d.netBase; if (d.date > addDays(today, -365)) row.ttm += d.netBase;
  }
  for (const f of forecast) rows.get(f.ticker).fwd += f.amountBase;
  table($('#divByTicker'), [...rows.values()].filter((x) => x.received || x.fwd), [
    { key: 'ticker', label: tr('Company'), render: (x) => `<b>${esc(x.ticker)}</b> <span class="muted small">${esc(short(x.name, 28))}</span>` },
    { key: 'received', label: tr('Received (all)'), cls: 'num', render: (x) => money(x.received, base) },
    { key: 'ttm', label: tr('Last 12m'), cls: 'num', render: (x) => money(x.ttm, base) },
    { key: 'fwd', label: tr('Next 12m'), cls: 'num', render: (x) => money(x.fwd, base) },
    { key: 'yield', label: tr('Yield'), cls: 'num', sort: (x) => (x.value ? x.fwd / x.value : 0), render: (x) => pct(x.value ? x.fwd / x.value : 0, { sign: false }) },
    { key: 'yoc', label: tr('Yield on cost'), cls: 'num', sort: (x) => (x.cost ? x.fwd / x.cost : 0), render: (x) => pct(x.cost ? x.fwd / x.cost : 0, { sign: false }) },
  ], { sortKey: 'fwd', empty: 'No dividends yet.' });

  const allPays = [...r.dividends].reverse();
  const drawPays = (limit) => table($('#divList'), allPays.slice(0, limit), [
    { key: 'date', label: tr('Date'), render: (d) => fmtDate(d.date) },
    { key: 'ticker', label: tr('Ticker'), render: (d) => `<b>${esc(d.ticker || '')}</b>${d.estimated ? ' <span class="tag warn">est.</span>' : ''}` },
    { key: 'gross', label: tr('Gross'), cls: 'num', render: (d) => money(d.gross, d.currency) },
    { key: 'tax', label: tr('Tax'), cls: 'num', render: (d) => money(d.tax, d.currency) },
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
