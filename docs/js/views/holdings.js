// holdings page — split from the former views.js
import { todayISO, trailingYield, Series, TAX_FREE_TYPES, tradeStats } from '../engine.js';
import { store } from '../store.js';
import { t as tr } from '../i18n.js';
import { BOND_TYPES, addMonths, bondTicker, seriesCode, schedule as bondSchedule, redemption as bondRedemption, valueOn as bondValueOn } from '../bonds.js';
import { loadCpi } from '../data.js';
import { $, $$, esc, money, num, qty, pct, cls, fmtDate, kpi, toast, table, chart, cssVar, downsample } from '../ui.js';
import { RANGES, emptyState, lineOpts, modal, rangeStart, segmented, short, warningsBlock } from './common.js';
import { txTable } from './transactions.js';


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
  <div class="card"><div class="card-head"><h3>Closed positions</h3></div><div id="cTable"></div></div>
  <div class="card"><div class="card-head"><h3>Closed trades</h3><span class="muted small">every sale, matched FIFO</span></div>
    <div class="kpis compact" id="tsKpis"></div><div class="grid-2"><div id="tsYears"></div><div id="tsList"></div></div></div>`;

  table($('#hTable', el), r.holdings, [
    { key: 'ticker', label: tr('Asset'), render: (h) => `<b>${esc(h.ticker)}</b>${h.stalePrice ? ' <span class="tag warn" title="no market data">manual</span>' : ''}<div class="muted small">${esc(short(h.name, 30))}</div>` },
    { key: 'qty', label: tr('Shares'), cls: 'num', render: (h) => qty(h.qty) },
    { key: 'avgPrice', label: tr('Avg price'), cls: 'num', render: (h) => money(h.avgPrice, h.currency) },
    { key: 'price', label: tr('Price'), cls: 'num', render: (h) => `${money(h.price, h.currency)}<div class="small ${cls(h.dayChangePct)}">${pct(h.dayChangePct)}</div>` },
    { key: 'value', label: `Value (${base})`, cls: 'num', render: (h) => money(h.value, base) },
    { key: 'weight', label: tr('Weight'), cls: 'num', render: (h) => `${pct(h.weight, { sign: false, digits: 1 })}<div class="bar"><i style="width:${(h.weight * 100).toFixed(1)}%"></i></div>` },
    { key: 'unrealized', label: tr('Unrealized'), cls: 'num', render: (h) => `<span class="${cls(h.unrealized)}">${money(h.unrealized, base, { sign: true })}</span><div class="small ${cls(h.unrealized)}">${pct(h.unrealizedPct)}</div>` },
    { key: 'dividends', label: tr('Dividends'), cls: 'num', render: (h) => money(h.dividends, base) },
    { key: 'totalReturn', label: tr('Total return'), cls: 'num', render: (h) => `<span class="${cls(h.totalReturn)}">${money(h.totalReturn, base, { sign: true })}</span>` },
  ], { sortKey: 'value', onRowClick: (h) => holdingModal(h, ctx) });

  table($('#cTable', el), r.closed, [
    { key: 'ticker', label: tr('Asset'), render: (h) => `<b>${esc(h.ticker)}</b> <span class="muted small">${esc(short(h.name, 30))}</span>` },
    { key: 'realized', label: tr('Realized'), cls: 'num', render: (h) => `<span class="${cls(h.realized)}">${money(h.realized, base, { sign: true })}</span>` },
    { key: 'dividends', label: tr('Dividends'), cls: 'num', render: (h) => money(h.dividends, base) },
    { key: 'totalReturn', label: tr('Total'), cls: 'num', render: (h) => `<span class="${cls(h.totalReturn)}">${money(h.totalReturn, base, { sign: true })}</span>` },
  ], { sortKey: 'totalReturn', onRowClick: (h) => holdingModal(h, ctx), empty: 'No closed positions.' });

  const ts = tradeStats(r.trades);
  $('#tsKpis', el).innerHTML = ts.count ? [
    kpi('Trades', String(ts.count), `${pct(ts.winRate, { sign: false, digits: 0 })} winners`),
    kpi('Realized', `<span class="${cls(ts.total)}">${money(ts.total, base, { sign: true })}</span>`),
    kpi('Average winner', `<span class="pos">${pct(ts.avgWinPct)}</span>`), kpi('Average loser', `<span class="neg">${pct(ts.avgLossPct)}</span>`),
    kpi('Profit factor', ts.profitFactor === Infinity ? '∞' : num(ts.profitFactor, 2), 'gains ÷ losses'),
    kpi('Average holding', `${num(ts.avgHoldingDays, 0)} d`),
  ].join('') : '<p class="muted">No sales yet.</p>';
  table($('#tsYears', el), ts.byYear, [
    { key: 'year', label: 'Year' }, { key: 'trades', label: 'Trades', cls: 'num' },
    { key: 'wins', label: 'Winners', cls: 'num', render: (y) => pct(y.wins / y.trades, { sign: false, digits: 0 }) },
    { key: 'gain', label: 'Realized', cls: 'num', render: (y) => `<span class="${cls(y.gain)}">${money(y.gain, base, { sign: true })}</span>` },
  ], { sortKey: 'year', empty: '—' });
  table($('#tsList', el), ts.list, [
    { key: 'date', label: 'Sold', render: (t) => fmtDate(t.date) }, { key: 'ticker', label: 'Ticker', render: (t) => `<b>${esc(t.ticker)}</b>` },
    { key: 'holdingDays', label: 'Held', cls: 'num', render: (t) => `${t.holdingDays} d` },
    { key: 'gain', label: 'Gain', cls: 'num', render: (t) => `<span class="${cls(t.gain)}">${money(t.gain, base, { sign: true })}</span><div class="small ${cls(t.pct)}">${pct(t.pct)}</div>` },
  ], { sortKey: 'date', empty: '—' });
}

export function holdingModal(h, ctx) {
  if (ctx.settings.bonds?.[h.ticker]) return bondModal(h, ctx);
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
        { label: tr('Buy'), data: marks('BUY'), showLine: false, pointRadius: 5, pointBackgroundColor: cssVar('--pos'), borderColor: cssVar('--pos') },
        { label: tr('Sell'), data: marks('SELL'), showLine: false, pointRadius: 5, pointBackgroundColor: cssVar('--neg'), borderColor: cssVar('--neg') },
      ] },
      options: lineOpts(h.currency),
    });
  });
  if (h.lots.length) {
    table($('#lotsT', el), h.lots, [
      { key: 'date', label: tr('Bought'), render: (l) => fmtDate(l.date) },
      { key: 'portfolioId', label: tr('Portfolio'), render: (l) => esc(ctx.portfolioName(l.portfolioId)) },
      { key: 'qty', label: tr('Shares'), cls: 'num', render: (l) => qty(l.qty) },
      { key: 'price', label: tr('Price'), cls: 'num', render: (l) => money(l.price, l.currency) },
      { key: 'gain', label: tr('Gain'), cls: 'num', sort: (l) => h.price / l.price, render: (l) => `<span class="${cls(h.price - l.price)}">${pct(h.price / l.price - 1)}</span>` },
    ], { sortKey: 'date', sortDir: 1 });
  }
  txTable($('#txT', el), txs, ctx, { compact: true });
}

export function bondForm(ctx, existing = null) {
  const s = ctx.state;
  const pid = ctx.selected !== 'all' ? ctx.selected : s.portfolios[0].id;
  const b = existing || { type: 'EDO', purchaseDate: todayISO(), firstRate: '', margin: '' };
  const { el, close } = modal(existing ? 'Edit bond terms' : 'Add treasury bonds', `
    <p class="muted small">Polish retail treasury bonds (obligacje skarbowe). Enter the terms of your series from
      <a href="https://www.obligacjeskarbowe.pl/" target="_blank" rel="noopener">obligacjeskarbowe.pl</a> or your bond account:
      first-year rate and, for inflation-linked bonds, the margin. Later rates follow inflation automatically and can be corrected per period.</p>
    <form id="bf" class="form">
      <label>Type<select name="type" ${existing ? 'disabled' : ''}>${Object.entries(BOND_TYPES).map(([k, d]) => `<option value="${k}" ${k === b.type ? 'selected' : ''}>${k} — ${d.label}</option>`).join('')}</select></label>
      <label>Purchase date<input type="date" name="purchaseDate" value="${b.purchaseDate}" max="${todayISO()}" required ${existing ? 'disabled' : ''}></label>
      <label>First-year rate (%)<input type="number" step="0.01" min="0" name="firstRate" value="${b.firstRate}" required placeholder="e.g. 6.55"></label>
      <label data-margin>Margin above inflation (%)<input type="number" step="0.01" min="0" name="margin" value="${b.margin}" placeholder="EDO 2.00 · COI 1.50 · ROS 2.00 · ROD 2.50"></label>
      ${existing ? '' : `<label>Number of bonds (100 PLN each)<input type="number" min="1" step="1" name="qty" required></label>
      <label>Price per bond<input type="number" step="0.01" min="0" name="price" value="100"><span class="muted small">99.90 when rolling over (zamiana)</span></label>
      <label>Portfolio<select name="portfolioId">${s.portfolios.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`}
      <label>Early redemption fee per bond (PLN)<input type="number" step="0.01" min="0" name="fee" value="${b.fee ?? ''}" placeholder="default for the type"></label>
      <div class="full muted small" id="bfHint"></div>
      <div class="full row gap end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${existing ? 'Save' : 'Add bonds'}</button></div>
    </form>`);
  const f = $('#bf', el);
  const sync = () => {
    const type = f.type.value, d = f.purchaseDate.value || todayISO();
    $('[data-margin]', f).hidden = BOND_TYPES[type].kind !== 'cpi' && BOND_TYPES[type].kind !== 'ref';
    f.fee.placeholder = `default ${num(BOND_TYPES[type].fee, 2)} PLN`;
    $('#bfHint', f).textContent = `Series ${seriesCode(type, d)} · matures ${fmtDate(addMonths(d, BOND_TYPES[type].months))}`;
  };
  f.addEventListener('input', sync); sync();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = f.type.value, purchaseDate = f.purchaseDate.value;
    const ticker = existing?.ticker || bondTicker(type, purchaseDate);
    const terms = { type, purchaseDate, firstRate: +f.firstRate.value, margin: f.margin.value === '' ? 0 : +f.margin.value, overrides: existing?.overrides || {} };
    if (f.fee.value !== '') terms.fee = +f.fee.value;
    store.setSettings({ bonds: { ...(ctx.settings.bonds || {}), [ticker]: terms } });
    if (!existing) {
      store.upsertTransaction({ portfolioId: f.portfolioId.value, date: purchaseDate, type: 'BUY', ticker, quantity: +f.qty.value, price: +f.price.value || 100, fee: 0, currency: 'PLN', note: `${type} treasury bonds` });
      toast(`Added ${f.qty.value} × ${seriesCode(type, purchaseDate)}`);
    } else toast('Bond terms saved');
    close();
  });
}

export async function bondModal(h, ctx) {
  const terms = { ...ctx.settings.bonds[h.ticker], ticker: h.ticker };
  const cpi = await loadCpi();
  const periods = bondSchedule(terms, cpi);
  const today = ctx.result.today;
  const taxFree = h.portfolios.every((pid) => TAX_FREE_TYPES.has(ctx.state.portfolios.find((p) => p.id === pid)?.type));
  const red = bondRedemption(terms, periods, today, { taxFree });
  const v = bondValueOn(terms, periods, today);
  const def = BOND_TYPES[terms.type];
  const { el, close } = modal(`${esc(seriesCode(terms.type, terms.purchaseDate))} <span class="muted">${esc(def.label)}</span>`, `
    <div class="kpis compact">
      ${kpi('Value', money(h.value, 'PLN'), `${qty(h.qty)} bonds × ${money(v.value, 'PLN')}`)}
      ${kpi('Interest earned', money(h.qty * (v.value - 100) + h.qty * v.paid, 'PLN'), def.payout ? `paid out ${money(h.qty * v.paid, 'PLN')}` : 'capitalised')}
      ${kpi(red.matured ? 'At maturity' : 'If redeemed today', money(h.qty * red.net, 'PLN'), `fee ${money(h.qty * red.fee, 'PLN')} · tax ${money(h.qty * red.tax, 'PLN')}${taxFree ? ' (IKE/IKZE: no tax)' : ''}`)}
      ${kpi('Matures', fmtDate(periods[periods.length - 1].end), red.matured ? 'matured — record the payout' : `${Math.ceil((Date.parse(periods[periods.length - 1].end) - Date.parse(today)) / 864e5 / 30.4)} months left`)}
    </div>
    <p class="muted small">${cpi.source ? `Inflation: ${esc(cpi.source)}. ` : ''}Type the official rate into any period to override the estimate.</p>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>From</th><th>To</th><th class="num">Rate %</th><th>Basis</th><th class="num">Value at end</th></tr></thead><tbody>
    ${periods.map((p) => `<tr class="${today >= p.start && today < p.end ? 'current' : ''}"><td>${p.idx + 1}</td><td>${fmtDate(p.start)}</td><td>${fmtDate(p.end)}</td>
      <td class="num"><input type="number" step="0.01" class="sm tgt" data-ov="${p.idx}" value="${p.rate.toFixed(2)}" ${p.idx === 0 ? 'disabled' : ''}></td>
      <td class="small muted">${esc(p.source)}${p.cpi !== undefined ? ` (${num(p.cpi, 1)}% + ${num(terms.margin, 2)}%)` : ''}</td>
      <td class="num">${money(bondValueOn(terms, periods, p.end).value, 'PLN')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row gap wrap mt"><button class="btn" id="bEdit">Edit terms</button><button class="btn" id="bRedeem">Record redemption…</button></div>`, { wide: true });
  $$('[data-ov]', el).forEach((inp) => inp.addEventListener('change', () => {
    const ov = { ...(terms.overrides || {}) };
    const k = +inp.dataset.ov;
    if (inp.value === '') delete ov[k]; else ov[k] = +inp.value;
    const { ticker, ...rest } = terms;
    store.setSettings({ bonds: { ...ctx.settings.bonds, [h.ticker]: { ...rest, overrides: ov } } });
    toast('Rate saved'); close();
  }));
  $('#bEdit', el).addEventListener('click', () => { close(); bondForm(ctx, terms); });
  $('#bRedeem', el).addEventListener('click', () => {
    const d = prompt('Redemption date (YYYY-MM-DD)', red.matured ? periods[periods.length - 1].end : today);
    if (!d) return;
    const r = bondRedemption(terms, periods, d, { taxFree });
    const pid = h.portfolios[0];
    store.upsertTransaction({ portfolioId: pid, date: d, type: 'SELL', ticker: h.ticker, quantity: h.qty, price: Math.round(r.gross * 100) / 100, fee: Math.round(h.qty * r.fee * 100) / 100, currency: 'PLN', note: 'bond redemption' });
    if (r.tax) store.upsertTransaction({ portfolioId: pid, date: d, type: 'TAX', ticker: h.ticker, amount: Math.round(h.qty * r.tax * 100) / 100, currency: 'PLN', note: '19% tax on bond interest' });
    toast('Redemption recorded'); close();
  });
}
