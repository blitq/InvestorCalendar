// Small DOM / formatting / chart helpers shared by all views.
import { locale } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const nfCache = new Map();
function nf(opts) {
  const k = (locale() || '') + JSON.stringify(opts);
  if (!nfCache.has(k)) nfCache.set(k, new Intl.NumberFormat(locale(), opts));
  return nfCache.get(k);
}

export function money(v, ccy, { sign = false, compact = false, digits } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const d = digits ?? (compact ? 1 : 2);
  try {
    return nf({ style: 'currency', currency: ccy || 'USD', minimumFractionDigits: compact ? 0 : d, maximumFractionDigits: d,
      notation: compact ? 'compact' : 'standard', signDisplay: sign ? 'exceptZero' : 'auto' }).format(v);
  } catch {
    return `${num(v, d)} ${ccy}`;
  }
}

export function num(v, digits = 2, { sign = false } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return nf({ maximumFractionDigits: digits, minimumFractionDigits: Math.min(digits, 2) > 0 && Math.abs(v) < 1e6 ? Math.min(2, digits) : 0, signDisplay: sign ? 'exceptZero' : 'auto' }).format(v);
}

export function qty(v) {
  if (v === null || v === undefined) return '—';
  return nf({ maximumFractionDigits: 6 }).format(v);
}

export function pct(v, { sign = true, digits = 2 } = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return nf({ style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: sign ? 'exceptZero' : 'auto' }).format(v);
}

export const cls = (v) => (v > 1e-9 ? 'pos' : v < -1e-9 ? 'neg' : '');

export function fmtDate(iso, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString(locale(), opts);
}

export function html(strings, ...vals) {
  return strings.reduce((acc, s, i) => acc + s + (i < vals.length ? (vals[i] ?? '') : ''), '');
}

export function kpi(label, value, sub = '', subClass = '') {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>` +
    (sub ? `<div class="kpi-sub ${subClass}">${sub}</div>` : '') + '</div>';
}

export function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

export function download(filename, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Read a text file, detecting UTF-8 vs Windows-1250 (Polish broker exports). */
export async function readFile(file) {
  const { decodeBytes } = await import('./importers.js');
  return decodeBytes(await file.arrayBuffer());
}

/** Sortable table. columns: [{key, label, render?, sort?, cls?}] */
export function table(el, rows, columns, { sortKey, sortDir = -1, onRowClick, empty = 'Nothing here yet.', rowClass } = {}) {
  let key = sortKey, dir = sortDir;
  function draw() {
    const col = columns.find((c) => c.key === key);
    const sorted = col ? [...rows].sort((a, b) => {
      const va = col.sort ? col.sort(a) : a[col.key], vb = col.sort ? col.sort(b) : b[col.key];
      if (typeof va === 'string' || typeof vb === 'string') return dir * String(va ?? '').localeCompare(String(vb ?? ''));
      return dir * ((va ?? -Infinity) - (vb ?? -Infinity));
    }) : rows;
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>${columns.map((c) =>
      `<th class="${c.cls || ''} ${c.key === key ? 'sorted' : ''}" data-k="${c.key}">${esc(c.label)}${c.key === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>` +
      `<tbody>${sorted.length ? sorted.map((r, i) => `<tr data-i="${rows.indexOf(r)}" class="${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}">${columns.map((c) =>
        `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" class="empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;
    el.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      if (key === th.dataset.k) dir = -dir; else { key = th.dataset.k; dir = -1; }
      draw();
    }));
    if (onRowClick) el.querySelectorAll('tbody tr[data-i]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input')) return;
      onRowClick(rows[+tr.dataset.i]);
    }));
  }
  draw();
}

// ---------------------------------------------------------------- charts (Chart.js)

const charts = new Map();

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#a855f7', '#64748b'];

export function chart(canvas, config) {
  if (!window.Chart) return null;
  const prev = charts.get(canvas.id);
  if (prev) prev.destroy();
  const grid = cssVar('--border'), text = cssVar('--muted');
  window.Chart.defaults.color = text;
  window.Chart.defaults.borderColor = grid;
  window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const c = new window.Chart(canvas, config);
  charts.set(canvas.id, c);
  return c;
}

export function destroyCharts() {
  for (const c of charts.values()) c.destroy();
  charts.clear();
}

/** Evenly thin a series to at most `max` points, always keeping the last one. */
export function downsample(n, max = 500) {
  if (n <= max) return [...Array(n).keys()];
  const step = (n - 1) / (max - 1);
  const idx = [];
  for (let i = 0; i < max; i++) idx.push(Math.round(i * step));
  return [...new Set(idx)];
}
