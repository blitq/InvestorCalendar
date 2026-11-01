// rebalance page — split from the former views.js
import { rebalancePlan } from '../engine.js';
import { store } from '../store.js';
import { t as tr } from '../i18n.js';
import { $, $$, esc, money, num, qty, pct, toast, table } from '../ui.js';
import { emptyState, short } from './common.js';


export async function rebalance(el, ctx) {
  const { result: r, base, quotes, market } = ctx;
  if (!ctx.txs.length) return emptyState(el, ctx);
  const allTargets = ctx.settings.targets || {};
  let targets = { ...(allTargets[ctx.selected] || {}) };
  let opts = { cash: 0, mode: 'buy', wholeShares: true };
  const save = () => store.setSettings({ targets: { ...allTargets, [ctx.selected]: targets } });
  const unit = (tk) => {
    const h = r.holdings.find((x) => x.ticker === tk);
    const ccy = h?.currency || quotes[tk]?.currency;
    const px = h?.price ?? market.lastPrice(tk) ?? quotes[tk]?.price;
    const fxr = ccy ? market.fxRate(ccy, base, r.today) : null;
    return px && fxr ? px * fxr : null;
  };

  el.innerHTML = `
  <div class="card">
    <div class="card-head wrap"><h3>Target allocation</h3>
      <div class="row gap wrap">
        <button class="btn sm-btn" id="rbCurrent">Use current weights</button>
        <button class="btn sm-btn" id="rbEqual">Equal weights</button>
        <button class="btn sm-btn" id="rbClear">Clear</button>
      </div></div>
    <p class="muted small">Set a target % for each asset (they are scaled to 100%). Assets without a target are left out. Targets are saved per portfolio selection${ctx.selected === 'all' ? ' (currently: all portfolios)' : ''}.</p>
    <div class="row gap wrap opts">
      <label class="muted small">New cash to invest (${base}) <input type="number" min="0" step="any" id="rbCash" class="sm" value="0" style="width:130px"></label>
      <label class="muted small">Mode <select id="rbMode" class="sm"><option value="buy">Buy only (invest new cash, never sell)</option><option value="full">Full rebalance (buy and sell)</option></select></label>
      <label class="check small"><input type="checkbox" id="rbWhole" checked> whole shares</label>
      <form id="rbAdd" class="row gap"><input name="t" placeholder="Add ticker" class="sm" list="rbList" style="width:130px"><button class="btn sm-btn">Add</button></form>
      <datalist id="rbList">${Object.keys(quotes).map((k) => `<option value="${esc(k)}">${esc(quotes[k].name || '')}</option>`).join('')}</datalist>
    </div>
    <div id="rbSum" class="small"></div>
    <div id="rbTable"></div>
  </div>
  <div class="card"><div class="card-head"><h3>Orders to place</h3><button class="btn sm-btn" id="rbCopy">Copy</button></div><div id="rbOrders"></div></div>`;

  function draw() {
    const rows = r.holdings.map((h) => ({ key: h.ticker, value: h.value, unitPrice: unit(h.ticker) }));
    for (const k of Object.keys(targets)) if (!rows.some((x) => x.key === k)) rows.push({ key: k, value: 0, unitPrice: unit(k) });
    const sum = Object.values(targets).reduce((a, b) => a + (+b || 0), 0);
    $('#rbSum').innerHTML = Object.keys(targets).length ? `Targets add up to <b class="${Math.abs(sum - 100) < 0.01 ? 'pos' : 'neg'}">${num(sum, 2)}%</b>${Math.abs(sum - 100) >= 0.01 ? ' — they will be scaled to 100%' : ''}` : '<span class="muted">No targets yet — start with “Use current weights”.</span>';
    const plan = rebalancePlan(rows, targets, opts);
    const byKey = Object.fromEntries(plan.items.map((i) => [i.key, i]));
    const totalHeld = r.holdings.reduce((s2, h) => s2 + h.value, 0);
    const list = rows.map((x) => ({ ...x, name: quotes[x.key]?.name || x.key, curW: totalHeld ? x.value / totalHeld : 0, p: byKey[x.key] }));
    table($('#rbTable'), list, [
      { key: 'key', label: tr('Asset'), render: (x) => `<b>${esc(x.key)}</b><div class="muted small">${esc(short(x.name, 26))}</div>` },
      { key: 'value', label: `Value (${base})`, cls: 'num', render: (x) => money(x.value, base) },
      { key: 'curW', label: tr('Now'), cls: 'num', render: (x) => pct(x.curW, { sign: false, digits: 1 }) },
      { key: 'target', label: tr('Target %'), cls: 'num', sort: (x) => +targets[x.key] || 0, render: (x) => `<input type="number" min="0" max="100" step="0.1" class="sm tgt" data-k="${esc(x.key)}" value="${targets[x.key] ?? ''}">` },
      { key: 'drift', label: tr('Drift'), cls: 'num', sort: (x) => x.p?.drift ?? 0, render: (x) => (x.p ? `<span class="${Math.abs(x.p.drift) > 0.05 ? 'neg' : 'muted'}">${num(x.p.drift * 100, 1, { sign: true })} pp</span>` : '') },
      { key: 'amount', label: tr('Trade'), cls: 'num', sort: (x) => x.p?.amount ?? 0, render: (x) => (x.p && Math.abs(x.p.amount) > 0.005 ? `<span class="${x.p.amount > 0 ? 'pos' : 'neg'}">${x.p.amount > 0 ? 'Buy' : 'Sell'} ${x.p.shares !== null ? `${qty(Math.abs(x.p.shares))} sh · ` : ''}${money(Math.abs(x.p.amount), base)}</span>` : (x.p ? '—' : '')) },
      { key: 'after', label: tr('After'), cls: 'num', sort: (x) => x.p?.after ?? 0, render: (x) => (x.p ? pct(x.p.after, { sign: false, digits: 1 }) : '') },
    ], { sortKey: 'value', empty: 'No positions.' });
    $$('.tgt', el).forEach((inp) => inp.addEventListener('change', () => {
      if (inp.value === '') delete targets[inp.dataset.k]; else targets[inp.dataset.k] = Math.max(0, +inp.value);
      save();
    }));
    const orders = plan.items.filter((i) => Math.abs(i.amount) > 0.005);
    $('#rbOrders').innerHTML = orders.length ? orders.map((i) => `<div class="mini-row"><span><b class="${i.amount > 0 ? 'pos' : 'neg'}">${i.amount > 0 ? 'BUY' : 'SELL'}</b> ${i.shares !== null ? qty(Math.abs(i.shares)) : ''} <b>${esc(i.key)}</b> ${i.unitPrice ? `<span class="muted small">@ ≈ ${money(i.unitPrice, base)}</span>` : ''}</span><span>${money(Math.abs(i.amount), base)}</span></div>`).join('') +
      `<div class="mini-row"><span class="muted">Cash left</span><span>${money(plan.cashLeft, base)}</span></div>` : '<div class="muted">Nothing to do — you are on target (or add new cash).</div>';
    $('#rbCopy').onclick = () => navigator.clipboard?.writeText(orders.map((i) => `${i.amount > 0 ? 'BUY' : 'SELL'} ${i.shares !== null ? Math.abs(i.shares) : ''} ${i.key} (${money(Math.abs(i.amount), base)})`).join('\n')).then(() => toast('Copied'));
  }
  $('#rbCash').addEventListener('input', (e) => { opts.cash = Math.max(0, +e.target.value || 0); draw(); });
  $('#rbMode').addEventListener('change', (e) => { opts.mode = e.target.value; draw(); });
  $('#rbWhole').addEventListener('change', (e) => { opts.wholeShares = e.target.checked; draw(); });
  $('#rbCurrent').addEventListener('click', () => { const tot = r.holdings.reduce((a, h) => a + h.value, 0); targets = Object.fromEntries(r.holdings.map((h) => [h.ticker, Math.round((h.value / tot) * 1000) / 10])); save(); });
  $('#rbEqual').addEventListener('click', () => { const ks = Object.keys(targets).length ? Object.keys(targets) : r.holdings.map((h) => h.ticker); targets = Object.fromEntries(ks.map((k) => [k, Math.round(10000 / ks.length) / 100])); save(); });
  $('#rbClear').addEventListener('click', () => { if (confirm('Remove all targets?')) { targets = {}; save(); } });
  $('#rbAdd').addEventListener('submit', (e) => { e.preventDefault(); const t = e.target.t.value.trim().toUpperCase(); if (t) { targets[t] = targets[t] ?? 0; save(); } });
  draw();
}
