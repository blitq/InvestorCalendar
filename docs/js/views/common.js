// common page — split from the former views.js
import { addDays, todayISO } from '../engine.js';
import { store } from '../store.js';
import { $, $$, esc, money, num, pct, fmtDate, toast, chart, cssVar, PALETTE } from '../ui.js';
import { calendar } from './calendar.js';
import { dividends } from './dividends.js';
import { transactions } from './transactions.js';


export const RANGES = [['1M', 30], ['3M', 91], ['YTD', 'ytd'], ['1Y', 365], ['3Y', 1096], ['5Y', 1827], ['Max', null]];

export function rangeStart(range, firstDate, today = todayISO()) {
  if (range === null) return firstDate;
  if (range === 'ytd') return today.slice(0, 4) + '-01-01';
  return addDays(today, -range);
}

export function emptyState(el, ctx) {
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

export async function loadDemo() {
  if (store.get().transactions.length && !confirm('Replace your current data with the demo portfolio?')) return;
  const r = await fetch('demo.json');
  store.loadDemo(await r.json());
  toast('Demo portfolio loaded');
}

export function warningsBlock(ctx) {
  const w = [...ctx.result.warnings];
  if (ctx.missing.length) {
    w.unshift(`No market data for ${ctx.missing.join(', ')}. Add them to tickers.json (Settings → Market data) or set a manual price.`);
  }
  return w.length ? `<div class="alert"><b>Heads up:</b><ul>${w.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
}

export function short(s, n = 22) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

export function segmented(el, items, initial, onChange) {
  el.innerHTML = items.map(([label]) => `<button data-l="${label}" class="${label === initial ? 'on' : ''}">${label}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', el).forEach((x) => x.classList.toggle('on', x === b));
    onChange(items.find(([l]) => l === b.dataset.l)[1]);
  });
  onChange(items.find(([l]) => l === initial)[1]);
}

export function lineOpts(unit) {
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

export function doughnut(canvas, legendEl, groups, base) {
  chart(canvas, {
    type: 'doughnut',
    data: { labels: groups.map((g) => g.label), datasets: [{ data: groups.map((g) => g.value), backgroundColor: groups.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderColor: cssVar('--card') }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', animation: false, plugins: { legend: { display: false },
      tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed, base)} (${pct(groups[c.dataIndex].weight, { sign: false })})` } } } },
  });
  if (legendEl) legendEl.innerHTML = groups.map((g, i) => `<div class="mini-row"><span><i class="dot" style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(short(g.label, 26))}</span><span>${pct(g.weight, { sign: false, digits: 1 })}</span></div>`).join('');
}

export function modal(title, bodyHtml, { wide = false } = {}) {
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

export function barOpts(base, stacked = false) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: stacked, labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y, base)}` } } },
    scales: { x: { stacked, grid: { display: false } }, y: { stacked, ticks: { callback: (v) => money(v, base, { compact: true }) } } },
  };
}
