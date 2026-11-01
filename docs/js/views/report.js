// Period report: month / quarter / year summary, printable.
import { periodStats, contributions, addDays, todayISO } from '../engine.js';
import { t as tr } from '../i18n.js';
import { $, esc, money, num, pct, cls, fmtDate, kpi, table, chart, cssVar, PALETTE } from '../ui.js';
import { emptyState, lineOpts } from './common.js';
import { txTable } from './transactions.js';

const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // m is 1-based

/** Period [start, end] for a key like 2026-03, 2026-Q1 or 2026. */
export function periodRange(key, today = todayISO()) {
  let start, end;
  if (/^\d{4}-\d{2}$/.test(key)) { const [y, m] = key.split('-').map(Number); start = `${key}-01`; end = lastDay(y, m); }
  else if (/^\d{4}-Q[1-4]$/.test(key)) { const y = +key.slice(0, 4), q = +key.slice(6); start = `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`; end = lastDay(y, q * 3); }
  else { start = `${key}-01-01`; end = `${key}-12-31`; }
  return { start, end: end > today ? today : end, before: addDays(start, -1) };
}

export function periodOptions(firstDate, today = todayISO()) {
  const out = [];
  const y0 = +firstDate.slice(0, 4), y1 = +today.slice(0, 4);
  for (let y = y1; y >= y0; y--) {
    out.push([String(y), String(y)]);
    for (let q = 4; q >= 1; q--) { const k = `${y}-Q${q}`; if (periodRange(k).start <= today && periodRange(k).end >= firstDate) out.push([k, `${y} Q${q}`]); }
    for (let m = 12; m >= 1; m--) { const k = `${y}-${String(m).padStart(2, '0')}`; if (`${k}-01` <= today && periodRange(k).end >= firstDate) out.push([k, fmtDate(`${k}-01`, { month: 'long', year: 'numeric' })]); }
  }
  return out;
}

export async function report(el, ctx) {
  const { result: r, base, market } = ctx;
  if (!ctx.txs.length) return emptyState(el, ctx);
  const today = r.today;
  const opts = periodOptions(r.series.dates[0], today);
  const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const key = new URLSearchParams(location.hash.split('?')[1] || '').get('p') || (opts.some(([k]) => k === prevMonth) ? prevMonth : opts[0][0]);
  const { start, end, before } = periodRange(key, today);
  const p = periodStats(r.series, before, end);
  const inPeriod = (d) => d >= start && d <= end;
  const flows = r.series.dates.reduce((a, d, i) => a + (inPeriod(d) ? r.series.flow[i] : 0), 0);
  const divs = r.dividends.filter((d) => inPeriod(d.date));
  const divSum = divs.reduce((a, d) => a + d.netBase, 0);
  const txs = ctx.txs.filter((t) => inPeriod(t.date));
  const bench = ctx.benchmarks.find((b) => market.prices[b]?.length);
  const bRet = (() => {
    if (!bench) return null;
    const s = market.prices[bench], ccy = market.currency(bench);
    const a = s.at(before), b = s.at(end);
    const fa = market.fxRate(ccy, base, before) ?? 1, fb = market.fxRate(ccy, base, end) ?? 1;
    return a && b ? (b * fb) / (a * fa) - 1 : null;
  })();
  const contrib = contributions(ctx.txs, market, { base, from: before, to: end, autoDividends: ctx.settings.autoDividends, estimateWithholding: ctx.settings.estimateWithholding, today });
  const label = opts.find(([k]) => k === key)?.[1] || key;

  el.innerHTML = `
  <div class="card no-print"><div class="card-head wrap"><h3>Report</h3>
    <div class="row gap wrap"><select id="rpSel" class="sm">${opts.map(([k, l]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <button class="btn sm-btn" id="rpPrint">Print / PDF</button></div></div></div>
  <h2 class="report-title">${esc(label)} <span class="muted small">${fmtDate(start)} – ${fmtDate(end)} · ${esc(ctx.selected === 'all' ? tr('All portfolios') : ctx.portfolioName(ctx.selected))}</span></h2>
  <div class="kpis">
    ${kpi('Value at start', money(p?.startValue ?? 0, base))}
    ${kpi('Value at end', money(p?.endValue ?? 0, base), p ? `${money((p.endValue - p.startValue), base, { sign: true })} change` : '')}
    ${kpi('Net money in', money(flows, base, { sign: true }))}
    ${kpi('Profit', `<span class="${cls(p?.profit)}">${money(p?.profit ?? 0, base, { sign: true })}</span>`)}
    ${kpi('Return (TWR)', `<span class="${cls(p?.twr)}">${pct(p?.twr)}</span>`, bench ? `${esc(ctx.meta.benchmarks[bench] || bench)}: ${pct(bRet)}` : '')}
    ${kpi('Dividends', money(divSum, base), `${divs.length} payments`)}
  </div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Value</h3></div><div class="chart-box small"><canvas id="rpChart"></canvas></div></div>
    <div class="card"><div class="card-head"><h3>Best and worst</h3></div><div id="rpBest"></div></div>
  </div>
  <div class="card"><div class="card-head"><h3>Transactions (${txs.length})</h3></div><div id="rpTx"></div></div>
  <div class="card"><div class="card-head"><h3>Dividends (${divs.length})</h3></div><div id="rpDiv"></div></div>`;

  $('#rpSel').addEventListener('change', (e) => { history.replaceState(null, '', `#/report?p=${e.target.value}`); report(el, ctx); });
  $('#rpPrint').addEventListener('click', () => window.print());

  const idx = r.series.dates.map((d, i) => [d, i]).filter(([d]) => d >= before && d <= end);
  chart($('#rpChart'), { type: 'line', data: { labels: idx.map(([d]) => d), datasets: [
    { label: tr('Value'), data: idx.map(([, i]) => r.series.value[i]), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent-soft'), fill: true, pointRadius: 0, borderWidth: 2 },
    { label: tr('Net invested'), data: idx.map(([, i]) => r.series.invested[i]), borderColor: cssVar('--muted'), borderDash: [4, 4], pointRadius: 0, borderWidth: 1.2, stepped: true },
  ] }, options: lineOpts(base) });

  const nonzero = contrib.filter((c) => Math.abs(c.profit) > 0.005);
  const best = nonzero.slice(0, 5), worst = nonzero.slice(-5).reverse().filter((c) => c.profit < 0 && !best.includes(c));
  $('#rpBest').innerHTML = [...best, ...worst].map((c, i) => `<div class="mini-row"><span><i class="dot" style="background:${c.profit >= 0 ? PALETTE[1] : PALETTE[3]}"></i><b>${esc(c.ticker)}</b></span>
    <span class="${cls(c.profit)}">${money(c.profit, base, { sign: true })} <span class="muted small">${pct(c.twr)}</span></span></div>`).join('') || '<div class="muted">No changes.</div>';

  txTable($('#rpTx'), txs, ctx, { compact: true });
  table($('#rpDiv'), divs, [
    { key: 'date', label: tr('Date'), render: (d) => fmtDate(d.date) },
    { key: 'ticker', label: tr('Ticker'), render: (d) => `<b>${esc(d.ticker || '')}</b>${d.estimated ? ' <span class="tag warn">est.</span>' : ''}` },
    { key: 'gross', label: tr('Gross'), cls: 'num', render: (d) => money(d.gross, d.currency) },
    { key: 'netBase', label: `Net (${base})`, cls: 'num', render: (d) => money(d.netBase, base) },
  ], { sortKey: 'date', sortDir: 1, empty: 'No dividends in this period.' });
}
