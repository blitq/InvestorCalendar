// Master chart: one configurable chart for value, capital, profit, returns, drawdown,
// benchmarks, dividends, cash flows and trade/event markers.
import { computePortfolio, addDays } from './engine.js';
import { buildMasterData } from './masterdata.js';
import { $, $$, esc, money, num, pct, cls, fmtDate, chart, cssVar, PALETTE, download, toast } from './ui.js';

const KEY = 'scrabfree_master';
const RANGES = [['1M', 30], ['3M', 91], ['6M', 182], ['YTD', 'ytd'], ['1Y', 365], ['3Y', 1096], ['5Y', 1827], ['Max', null]];
const BENCH_COLORS = [PALETTE[2], PALETTE[5], PALETTE[6], PALETTE[9]];

const SERIES = [
  ['value', 'Value'], ['invested', 'Invested'], ['profit', 'Profit'], ['return', 'Return %'], ['drawdown', 'Drawdown'],
  ['dividends', 'Dividends'], ['flows', 'Deposits / withdrawals'], ['trades', 'Buys & sells'], ['divMarks', 'Dividend markers'], ['events', 'Events'],
];

const DEFAULTS = {
  range: '1Y', from: null, to: null, gran: 'auto', log: false,
  on: { value: true, invested: true, profit: false, return: false, drawdown: false, dividends: true, flows: false, trades: true, divMarks: false, events: false },
  benches: [], benchMode: 'pct', returnMode: 'twr', assets: [],
};

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...s, on: { ...DEFAULTS.on, ...(s.on || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}
function saveState(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }

function windowFor(st, firstDate, today) {
  if (st.range === 'custom') return [st.from || firstDate, st.to || today];
  const r = RANGES.find(([l]) => l === st.range)?.[1];
  if (r === null || r === undefined) return [firstDate, today];
  if (r === 'ytd') return [`${+today.slice(0, 4) - 1}-12-31`, today];
  return [addDays(today, -r), today];
}

// draws a dashed vertical line under the active tooltip point
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(c) {
    const a = c.tooltip?.getActiveElements?.();
    if (!a?.length) return;
    const x = a[0].element.x, { top, bottom } = c.chartArea, g = c.ctx;
    g.save(); g.beginPath(); g.setLineDash([4, 4]); g.moveTo(x, top); g.lineTo(x, bottom);
    g.lineWidth = 1; g.strokeStyle = cssVar('--muted'); g.stroke(); g.restore();
  },
};
// solid background so PNG exports are not transparent
const background = {
  id: 'bg',
  beforeDraw(c) { const g = c.ctx; g.save(); g.fillStyle = cssVar('--card'); g.fillRect(0, 0, c.width, c.height); g.restore(); },
};

let abortPrev = null;

export async function masterChart(el, ctx, events = []) {
  abortPrev?.abort(); // drop window listeners from a previous render
  abortPrev = new AbortController();
  const sig = { signal: abortPrev.signal };
  const st = loadState();
  const benchList = ctx.benchmarks.filter((b) => ctx.market.prices[b]?.length);
  st.benches = st.benches.filter((b) => benchList.includes(b));
  const allAssets = [...ctx.result.holdings, ...ctx.result.closed].map((h) => h.ticker).sort();
  st.assets = st.assets.filter((a) => allAssets.includes(a));
  const today = ctx.result.today;

  el.innerHTML = `
  <div class="card master">
    <div class="card-head wrap">
      <h3>Master chart</h3>
      <div class="row gap wrap">
        <div class="seg" id="mRange">${RANGES.map(([l]) => `<button data-r="${l}">${l}</button>`).join('')}</div>
        <span class="row gap dates"><input type="date" id="mFrom" class="sm" aria-label="From"><span class="muted">–</span><input type="date" id="mTo" class="sm" aria-label="To"></span>
      </div>
    </div>
    <div class="chips" id="mChips">
      ${SERIES.map(([k, l]) => `<button class="chip" data-s="${k}"><i></i>${l}</button>`).join('')}
      ${benchList.map((b, i) => `<button class="chip" data-b="${esc(b)}" style="--c:${BENCH_COLORS[i % BENCH_COLORS.length]}"><i></i>${esc(ctx.meta.benchmarks[b] || b)}</button>`).join('')}
    </div>
    <div class="row gap wrap opts">
      <label class="muted small">Return <select id="mRet" class="sm"><option value="twr">time-weighted (TWR)</option><option value="mwr">money-weighted (XIRR p.a.)</option><option value="simple">profit ÷ invested</option></select></label>
      ${benchList.length ? `<label class="muted small">Benchmarks <select id="mBm" class="sm"><option value="pct">% change</option><option value="money">same money invested</option></select></label>` : ''}
      <label class="muted small">Points <select id="mGran" class="sm"><option value="auto">auto</option><option value="D">daily</option><option value="W">weekly</option><option value="M">monthly</option></select></label>
      <label class="check small"><input type="checkbox" id="mLog"> log scale</label>
      <details class="dropdown" id="mAssets"><summary class="btn sm-btn"></summary>
        <div class="dd-body"><div class="row gap"><button class="btn sm-btn" data-all>All</button><button class="btn sm-btn" data-open>Open only</button></div>
        ${allAssets.map((t) => `<label class="check small"><input type="checkbox" value="${esc(t)}"> ${esc(t)}</label>`).join('')}</div>
      </details>
      <div class="grow"></div>
      <span class="row gap"><button class="btn sm-btn" id="mReset" hidden>Reset zoom</button>
      <button class="btn sm-btn" id="mPng" title="Download chart as PNG">PNG</button>
      <button class="btn sm-btn" id="mCsv" title="Download visible data as CSV">CSV</button></span>
    </div>
    <div class="chart-box master-box" id="mBox"><canvas id="masterChart"></canvas><div class="zoom-sel" hidden></div></div>
    <div class="muted small hint">Drag across the chart to zoom in. Hover for every value on that date.</div>
    <div class="summary" id="mSummary"></div>
  </div>`;

  const memo = new Map();
  const resultFor = () => {
    if (!st.assets.length || st.assets.length === allAssets.length) return { r: ctx.result, txs: ctx.txs, filtered: false };
    const key = st.assets.join(',');
    if (!memo.has(key)) {
      const set = new Set(st.assets);
      const txs = ctx.txs.filter((t) => t.ticker && set.has(t.ticker));
      memo.set(key, { r: computePortfolio(txs, ctx.market, { base: ctx.base, autoDividends: ctx.settings.autoDividends, today }), txs, filtered: true });
    }
    return memo.get(key);
  };

  let current = null; // last built data + chart for export / zoom

  function syncControls() {
    $$('#mRange button', el).forEach((b) => b.classList.toggle('on', b.dataset.r === st.range));
    $$('[data-s]', el).forEach((b) => {
      b.classList.toggle('on', !!st.on[b.dataset.s]);
      b.disabled = b.dataset.s === 'profit' && st.log;
      b.title = b.disabled ? 'Profit can be negative, so it is hidden on a log scale' : '';
    });
    $$('[data-b]', el).forEach((b) => b.classList.toggle('on', st.benches.includes(b.dataset.b)));
    $('#mRet', el).value = st.returnMode;
    if ($('#mBm', el)) $('#mBm', el).value = st.benchMode;
    $('#mGran', el).value = st.gran;
    $('#mLog', el).checked = st.log;
    $('#mReset', el).hidden = st.range !== 'custom';
    const sel = st.assets.length && st.assets.length < allAssets.length;
    $('#mAssets summary', el).textContent = sel ? `Assets: ${st.assets.length > 3 ? st.assets.length + ' selected' : st.assets.join(', ')}` : 'Assets: all';
    $$('#mAssets input[type=checkbox]', el).forEach((cb) => { cb.checked = !sel || st.assets.includes(cb.value); });
  }

  function draw() {
    syncControls();
    saveState(st);
    const { r, txs, filtered } = resultFor();
    if (!r.series.dates.length) { $('#mBox', el).innerHTML = '<p class="muted">No data for this selection.</p>'; return; }
    const [from, to] = windowFor(st, r.series.dates[0], today);
    const heldTickers = new Set([...r.holdings, ...r.closed].map((h) => h.ticker));
    const d = buildMasterData(r.series, {
      from, to, gran: st.gran, market: ctx.market, base: ctx.base, benchmarks: st.benches,
      withMwr: st.on.return && st.returnMode === 'mwr', dividends: r.dividends, transactions: txs,
      events: events.filter((e) => heldTickers.has(e.ticker) && (e.type === 'earnings' || e.type === 'dividend')),
    });
    $('#mFrom', el).value = d.from; $('#mTo', el).value = d.to;
    $('#mFrom', el).max = $('#mTo', el).max = today;
    $('#mFrom', el).min = $('#mTo', el).min = r.series.dates[0];

    const base = ctx.base;
    const ds = [];
    const line = (o) => ds.push({ type: 'line', pointRadius: 0, pointHoverRadius: 3, borderWidth: 2, tension: 0.1, spanGaps: true, ...o });
    const accent = cssVar('--accent');
    if (st.on.value) line({ label: 'Value', data: d.value, yAxisID: 'y', fmt: 'money', borderColor: accent, backgroundColor: cssVar('--accent-soft'), fill: st.log ? false : 'origin', order: 1 });
    if (st.on.invested) line({ label: 'Net invested', data: d.invested, yAxisID: 'y', fmt: 'money', borderColor: cssVar('--muted'), borderDash: [5, 4], borderWidth: 1.5, stepped: true, tension: 0, order: 2 });
    if (st.on.profit && !st.log) line({ label: 'Profit', data: d.profit, yAxisID: 'y', fmt: 'money', borderColor: PALETTE[1], order: 2 });
    if (st.on.return) {
      const m = { twr: ['Return (TWR)', d.twr], mwr: ['Return (XIRR p.a.)', d.mwr], simple: ['Profit ÷ invested', d.simple] }[st.returnMode];
      line({ label: m[0], data: m[1], yAxisID: 'yPct', fmt: 'pct', borderColor: PALETTE[4], order: 2 });
    }
    if (st.on.drawdown) line({ label: 'Drawdown', data: d.drawdown, yAxisID: 'yPct', fmt: 'pct', borderColor: cssVar('--neg'), backgroundColor: 'rgba(239,68,68,0.12)', fill: 'origin', borderWidth: 1, order: 3 });
    st.benches.forEach((b) => {
      const color = BENCH_COLORS[benchList.indexOf(b) % BENCH_COLORS.length];
      const label = ctx.meta.benchmarks[b] || b;
      if (st.benchMode === 'money') line({ label: `${label} (same money)`, data: d.benches[b].money, yAxisID: 'y', fmt: 'money', borderColor: color, borderWidth: 1.5, order: 2 });
      else line({ label, data: d.benches[b].pct, yAxisID: 'yPct', fmt: 'pct', borderColor: color, borderWidth: 1.5, order: 2 });
    });
    const per = { D: 'month', W: 'week', M: 'month' }[d.gran];
    if (st.on.dividends) ds.push({ type: 'bar', label: `Dividends (per ${per})`, data: d.dividendBars, yAxisID: 'yBar', fmt: 'money', backgroundColor: 'rgba(13,148,136,0.55)', borderRadius: 2, order: 9, barPercentage: 0.9, categoryPercentage: 1 });
    if (st.on.flows) ds.push({ type: 'bar', label: filtered ? `Bought − sold (per ${per})` : `Net deposits (per ${per})`, data: d.flowBars, yAxisID: 'yBar', fmt: 'money',
      backgroundColor: d.flowBars.map((v) => (v >= 0 ? 'rgba(100,116,139,0.45)' : 'rgba(249,115,22,0.6)')), borderRadius: 2, order: 10, barPercentage: 0.9, categoryPercentage: 1 });

    // markers sit on the value line (or invested line when value is hidden)
    const anchor = st.on.value || !st.on.invested ? d.value : d.invested;
    const marks = (label, map, style, color, rotation, fmtItem) => {
      const data = d.labels.map((_, k) => (map.has(k) ? anchor[k] : null));
      ds.push({ type: 'line', label, data, yAxisID: 'y', fmt: 'marker', showLine: false, pointStyle: style, rotation, pointRadius: 6, pointHoverRadius: 8,
        pointBackgroundColor: color, pointBorderColor: cssVar('--card'), pointBorderWidth: 1.5, order: 0,
        details: d.labels.map((_, k) => (map.get(k) || []).map(fmtItem)) });
    };
    const fq = (t) => `${num(t.quantity, 6)} ${t.ticker} @ ${money(t.price, t.currency)}`;
    if (st.on.trades) {
      marks('Buy', d.markers.buys, 'triangle', cssVar('--pos'), 0, (t) => `Buy ${fq(t)}`);
      marks('Sell', d.markers.sells, 'triangle', cssVar('--neg'), 180, (t) => `Sell ${fq(t)}`);
    }
    if (st.on.divMarks) marks('Dividend', d.markers.dividends, 'circle', '#0d9488', 0, (x) => `${x.ticker} dividend ${money(x.netBase, base)}${x.estimated ? ' (est.)' : ''}`);
    if (st.on.events) marks('Event', d.markers.events, 'rectRot', PALETTE[0], 0, (x) => `${fmtDate(x.date, { month: 'short', day: 'numeric' })} ${x.ticker} ${x.type}`);

    const has = (axis) => ds.some((x) => x.yAxisID === axis && x.fmt !== 'marker');
    const bars = [...(st.on.dividends ? d.dividendBars : []), ...(st.on.flows ? d.flowBars : [])].filter((v) => v !== null);
    const barMax = Math.max(0, ...bars), barMin = Math.min(0, ...bars);
    const fmtVal = (dsx, v) => (dsx.fmt === 'pct' ? `${num(v, 2, { sign: true })}%` : money(v, base));
    const xFmt = d.gran === 'M' ? { month: 'short', year: '2-digit' } : (d.labels.length > 120 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });

    const c = chart($('#masterChart', el), {
      type: 'line',
      data: { labels: d.labels, datasets: ds },
      plugins: [crosshair, background],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (it) => it.raw !== null && it.raw !== undefined,
            itemSort: (a, b) => (a.dataset.fmt === 'marker') - (b.dataset.fmt === 'marker'),
            callbacks: {
              title: (items) => {
                const k = items[0].dataIndex;
                const dt = d.labels[k];
                if (d.gran === 'D') return fmtDate(dt, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
                const prev = k ? addDays(d.labels[k - 1], 1) : d.from;
                return `${fmtDate(prev, { month: 'short', day: 'numeric' })} – ${fmtDate(dt)}`;
              },
              label: (it) => (it.dataset.fmt === 'marker' ? it.dataset.details[it.dataIndex] : `${it.dataset.label}: ${fmtVal(it.dataset, it.raw)}`),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, autoSkip: true, callback(v) { const l = this.getLabelForValue(v); return l ? fmtDate(l, xFmt) : ''; } } },
          y: { display: has('y'), type: st.log ? 'logarithmic' : 'linear', position: 'left', ticks: { callback: (v) => money(+v, base, { compact: true }), maxTicksLimit: 8 } },
          yPct: { display: has('yPct'), position: 'right', grid: { drawOnChartArea: !has('y') }, ticks: { callback: (v) => `${num(+v, 0)}%` } },
          yBar: { display: false, min: barMin * 3.5, max: barMax ? barMax * 3.5 : 1 },
        },
      },
    });
    current = { d, chart: c, ds };
    drawSummary(d);
  }

  function drawSummary(d) {
    const s = d.summary;
    const item = (label, v, klass = '') => `<div><span class="muted small">${label}</span><b class="${klass}">${v}</b></div>`;
    $('#mSummary', el).innerHTML = [
      item(`${fmtDate(d.from)} → ${fmtDate(d.to)}`, `${money(s.startValue, ctx.base, { compact: true })} → ${money(s.endValue, ctx.base, { compact: true })}`),
      item('Profit', money(s.profit, ctx.base, { sign: true }), cls(s.profit)),
      item('Return (TWR)', pct(s.twr), cls(s.twr)),
      item('XIRR p.a.', pct(s.mwr), cls(s.mwr)),
      item('Net money in', money(s.netFlows, ctx.base, { sign: true })),
      item('Dividends', money(s.dividends, ctx.base)),
      item('Max drawdown', pct(s.maxDrawdown), s.maxDrawdown < 0 ? 'neg' : ''),
    ].join('');
  }

  // ---- controls
  $('#mRange', el).addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { st.range = b.dataset.r; draw(); } });
  const setCustom = () => { st.range = 'custom'; st.from = $('#mFrom', el).value || null; st.to = $('#mTo', el).value || null; if (st.from && st.to && st.from > st.to) [st.from, st.to] = [st.to, st.from]; draw(); };
  $('#mFrom', el).addEventListener('change', setCustom);
  $('#mTo', el).addEventListener('change', setCustom);
  $('#mChips', el).addEventListener('click', (e) => {
    const s = e.target.closest('[data-s]'), b = e.target.closest('[data-b]');
    if (s && !s.disabled) st.on[s.dataset.s] = !st.on[s.dataset.s];
    if (b) st.benches = st.benches.includes(b.dataset.b) ? st.benches.filter((x) => x !== b.dataset.b) : [...st.benches, b.dataset.b];
    if (s || b) draw();
  });
  $('#mRet', el).addEventListener('change', (e) => { st.returnMode = e.target.value; st.on.return = true; draw(); });
  $('#mBm', el)?.addEventListener('change', (e) => { st.benchMode = e.target.value; draw(); });
  $('#mGran', el).addEventListener('change', (e) => { st.gran = e.target.value; draw(); });
  $('#mLog', el).addEventListener('change', (e) => { st.log = e.target.checked; draw(); });
  $('#mReset', el).addEventListener('click', () => { st.range = 'Max'; st.from = st.to = null; draw(); });
  const assetsBox = $('#mAssets', el);
  assetsBox.addEventListener('change', () => {
    const picked = $$('input[type=checkbox]', assetsBox).filter((cb) => cb.checked).map((cb) => cb.value);
    st.assets = picked.length === allAssets.length ? [] : picked;
    if (!picked.length) { toast('Pick at least one asset'); st.assets = []; }
    draw();
  });
  assetsBox.addEventListener('click', (e) => {
    if (e.target.closest('[data-all]')) { st.assets = []; draw(); }
    if (e.target.closest('[data-open]')) { st.assets = ctx.result.holdings.map((h) => h.ticker).sort(); draw(); }
  });
  document.addEventListener('click', (e) => { if (assetsBox.open && !assetsBox.contains(e.target)) assetsBox.open = false; }, sig);

  $('#mPng', el).addEventListener('click', () => {
    if (!current) return;
    const a = document.createElement('a');
    a.href = current.chart.toBase64Image('image/png', 1);
    a.download = `portfolio-${current.d.from}-${current.d.to}.png`;
    a.click();
  });
  $('#mCsv', el).addEventListener('click', () => {
    if (!current) return;
    const cols = current.ds.filter((x) => x.fmt !== 'marker');
    const rows = [['date', ...cols.map((x) => `"${x.label.replace(/"/g, '""')}"`)].join(',')];
    current.d.labels.forEach((dt, k) => rows.push([dt, ...cols.map((x) => (x.data[k] === null || x.data[k] === undefined ? '' : +(+x.data[k]).toFixed(4)))].join(',')));
    download(`portfolio-${current.d.from}-${current.d.to}.csv`, rows.join('\n'), 'text/csv');
  });

  // ---- drag to zoom
  const box = $('#mBox', el), sel = $('.zoom-sel', box);
  let dragX = null;
  const relX = (e) => e.clientX - box.getBoundingClientRect().left;
  box.addEventListener('pointerdown', (e) => { if (e.button === 0 && current) { dragX = relX(e); sel.hidden = true; } });
  window.addEventListener('pointermove', (e) => {
    if (dragX === null) return;
    const x = relX(e), area = current.chart.chartArea;
    const a = Math.max(area.left, Math.min(dragX, x)), b = Math.min(area.right, Math.max(dragX, x));
    if (b - a < 6) { sel.hidden = true; return; }
    Object.assign(sel.style, { left: `${a}px`, width: `${b - a}px`, top: `${area.top}px`, height: `${area.bottom - area.top}px` });
    sel.hidden = false;
  }, sig);
  window.addEventListener('pointerup', (e) => {
    if (dragX === null) return;
    const x = relX(e), start = dragX;
    dragX = null; sel.hidden = true;
    if (Math.abs(x - start) < 8 || !current) return;
    const sc = current.chart.scales.x, n = current.d.labels.length - 1;
    const i1 = Math.max(0, Math.min(n, Math.round(sc.getValueForPixel(Math.min(start, x)))));
    const i2 = Math.max(0, Math.min(n, Math.round(sc.getValueForPixel(Math.max(start, x)))));
    if (i2 <= i1) return;
    st.range = 'custom';
    st.from = i1 > 0 ? addDays(current.d.labels[i1 - 1], 1) : current.d.labels[0];
    st.to = current.d.labels[i2];
    draw();
  }, sig);

  draw();
}
