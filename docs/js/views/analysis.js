// analysis page — split from the former views.js
import { periodStats, benchmarkSeries, groupBy } from '../engine.js';
import { t as tr } from '../i18n.js';
import { $, esc, money, num, pct, cls, fmtDate, kpi, toast, table, chart, cssVar, PALETTE, downsample } from '../ui.js';
import { doughnut, emptyState, lineOpts } from './common.js';


export async function analysis(el, ctx) {
  const { result: r, base, market } = ctx;
  const quotes = market.quotes;
  if (!ctx.txs.length) return emptyState(el, ctx);
  const H = [...r.holdings];
  const withCash = r.totals.cashValue > 0 ? [...H, { ticker: 'Cash', value: r.totals.cashValue, cash: true }] : H;
  const q = (h, k) => (h.cash ? 'Cash' : quotes[h.ticker]?.[k]);
  const groups = [
    ['Sector', groupBy(withCash, (h) => q(h, 'sector') || (quotes[h.ticker]?.quote_type === 'ETF' ? 'ETF / Fund' : null))],
    ['Country', groupBy(withCash, (h) => q(h, 'country'))],
    ['Currency', groupBy(withCash, (h) => (h.cash ? 'Cash' : h.currency))],
    ['Market', groupBy(withCash, (h) => q(h, 'market'))],
    ['Asset type', groupBy(withCash, (h) => (h.cash ? 'Cash' : ({ EQUITY: 'Stocks', ETF: 'ETFs', MUTUALFUND: 'Funds', CRYPTOCURRENCY: 'Crypto', BOND: 'Bonds' }[market.quotes[h.ticker]?.quote_type] || 'Other')))],
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
  <div class="row gap end share-row"><button class="btn sm-btn" id="shareBtn" title="Copy a link that shows weights and returns, never amounts">Share allocation link</button></div>
  <div class="grid-3" id="allocGrid">${groups.map(([title], i) => `<div class="card"><div class="card-head"><h3>${title}</h3></div><div class="chart-box small"><canvas id="al${i}"></canvas></div><div id="all${i}" class="legend-list"></div></div>`).join('')}</div>
  <div class="card"><div class="card-head"><h3>Actual vs “same money into a benchmark”</h3><select id="simSel" class="sm"></select></div>
    <p class="muted small">Every contribution and withdrawal you made is replayed into the benchmark (converted to ${base}).</p>
    <div class="chart-box"><canvas id="simChart"></canvas></div></div>
  <div class="card"><div class="card-head"><h3>Returns by year</h3></div><div id="yearT"></div></div>
  <div class="card"><div class="card-head"><h3>Monthly returns (TWR)</h3></div><div id="heat" class="heat"></div></div>`;

  groups.forEach(([, g], i) => doughnut($(`#al${i}`), $(`#all${i}`), g.slice(0, 10), base));
  $('#shareBtn').addEventListener('click', async () => {
    const link = shareLink(ctx);
    try { await navigator.clipboard.writeText(link); toast('Link copied — it contains weights and returns only'); }
    catch { prompt('Copy this link', link); }
  });

  const benches = ctx.benchmarks.filter((b) => market.prices[b]?.length);
  const sel = $('#simSel');
  sel.innerHTML = benches.map((b) => `<option value="${esc(b)}">${esc(ctx.meta.benchmarks[b] || b)}</option>`).join('');
  const drawSim = () => {
    if (!sel.value) return;
    const b = benchmarkSeries(r.series, market, sel.value, base);
    const idx = downsample(dates.length, 400);
    chart($('#simChart'), { type: 'line', data: { labels: idx.map((i) => dates[i]), datasets: [
      { label: tr('Your portfolio'), data: idx.map((i) => value[i]), borderColor: cssVar('--accent'), pointRadius: 0, borderWidth: 2 },
      { label: ctx.meta.benchmarks[sel.value] || sel.value, data: idx.map((i) => b.simulated[i]), borderColor: PALETTE[2], pointRadius: 0, borderWidth: 1.5 },
      { label: tr('Net invested'), data: idx.map((i) => r.series.invested[i]), borderColor: cssVar('--muted'), borderDash: [4, 4], pointRadius: 0, borderWidth: 1, stepped: true },
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
    { key: 'year', label: tr('Year') },
    { key: 'endValue', label: tr('End value'), cls: 'num', render: (x) => money(x.endValue, base) },
    { key: 'profit', label: tr('Profit'), cls: 'num', render: (x) => `<span class="${cls(x.profit)}">${money(x.profit, base, { sign: true })}</span>` },
    { key: 'twr', label: tr('Return'), cls: 'num', render: (x) => `<b class="${cls(x.twr)}">${pct(x.twr)}</b>` },
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

export function b64url(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export function unb64url(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); }

/** Link that shows weights and returns only — never amounts. */
export function shareLink(ctx) {
  const r = ctx.result;
  const payload = {
    v: 1, at: r.today, since: r.series.dates[0],
    twr: Math.round(r.totals.twr * 1000) / 1000, xirr: r.totals.xirr === null ? null : Math.round(r.totals.xirr * 1000) / 1000,
    w: r.holdings.map((h) => [h.ticker, Math.round(h.weight * 1000), ctx.market.quotes[h.ticker]?.sector || '']),
  };
  return `${location.origin}${location.pathname}#/shared?d=${b64url(JSON.stringify(payload))}`;
}

export async function shared(el) {
  let p;
  try { p = JSON.parse(unb64url(new URLSearchParams(location.hash.split('?')[1] || '').get('d') || '')); }
  catch { el.innerHTML = '<div class="card"><h3>This share link is broken.</h3></div>'; return; }
  const rows = p.w.map(([ticker, w, sector]) => ({ label: ticker, value: w, weight: w / 1000, sector }));
  el.innerHTML = `
  <div class="alert info">A shared portfolio snapshot from ${fmtDate(p.at)} — weights and returns only, no amounts.</div>
  <div class="kpis">${kpi('Return since start (TWR)', `<span class="${cls(p.twr)}">${pct(p.twr)}</span>`, `since ${fmtDate(p.since)}`)}${kpi('Annual return (XIRR)', pct(p.xirr))}${kpi('Positions', String(rows.length))}</div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Holdings</h3></div><div class="chart-box"><canvas id="shChart"></canvas></div></div>
    <div class="card"><div class="card-head"><h3>Weights</h3></div><div id="shList" class="legend-list"></div>
      <div class="card-head mt"><h3>By sector</h3></div><div id="shSec" class="legend-list"></div></div>
  </div>`;
  doughnut($('#shChart'), $('#shList'), rows, 'PLN');
  const secs = groupBy(rows.map((x) => ({ value: x.value, s: x.sector })), (x) => x.s || 'Other');
  $('#shSec').innerHTML = secs.map((x) => `<div class="mini-row"><span>${esc(x.label)}</span><span>${pct(x.weight, { sign: false, digits: 1 })}</span></div>`).join('');
}
