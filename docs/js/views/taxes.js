// taxes page — split from the former views.js
import { computePolishTax, TAX_FREE_TYPES, taxReportCSV } from '../engine.js';
import { buildMarket } from '../data.js';
import { t as tr } from '../i18n.js';
import { $, esc, download, money, num, qty, cls, fmtDate, kpi, table } from '../ui.js';
import { emptyState } from './common.js';
import { settings } from './settings.js';


export async function taxes(el, ctx) {
  if (!ctx.state.transactions.length) return emptyState(el, ctx);
  const tickers = [...new Set(ctx.state.transactions.filter((t) => t.ticker).map((t) => t.ticker))];
  const market = await buildMarket(tickers, { withNbp: true, manualPrices: ctx.settings.manualPrices, bonds: ctx.settings.bonds || {}, customAssets: ctx.settings.customAssets || {} });
  const taxFree = new Set(ctx.state.portfolios.filter((p) => TAX_FREE_TYPES.has(p.type)).map((p) => p.id));
  // treasury bonds: the 19% on interest is withheld by the issuer, they do not go into PIT-38
  const txs = (ctx.selected === 'all' ? ctx.state.transactions : ctx.txs).filter((t) => !taxFree.has(t.portfolioId) && !ctx.settings.bonds?.[t.ticker] && !ctx.settings.customAssets?.[t.ticker]); // custom assets (real estate, deposits…) are not PIT-38
  const st = ctx.settings;
  const tax = computePolishTax(txs, market, { dateMode: st.taxDateMode || 'trade', carryForward: st.taxCarryForward !== false, priorLosses: st.taxPriorLosses || {} });
  const excludedNote = taxFree.size ? `<div class="muted small">Excluded as tax-free: ${ctx.state.portfolios.filter((p) => taxFree.has(p.id)).map((p) => esc(p.name)).join(', ')} (IKE / IKZE / OIPE).</div>` : '';
  if (!tax.years.length) {
    el.innerHTML = '<div class="card"><h3>No taxable events yet</h3><p class="muted">Sales and recorded dividends will show up here.</p></div>';
    return;
  }
  const pick = new URLSearchParams(location.hash.split('?')[1] || '').get('y') || tax.years[0].year;
  const y = tax.years.find((x) => x.year === pick) || tax.years[0];
  const P = (v) => money(v, 'PLN');
  el.innerHTML = `
  <div class="alert info">Estimate of the Polish <b>PIT-38</b> using FIFO per portfolio (treat each portfolio as one broker account) and NBP mid rates from the business day before each transaction.
    Rates use the ${st.taxDateMode === 'settlement' ? 'T+2 settlement date' : 'trade date'}; prior-year losses are ${st.taxCarryForward === false ? 'not deducted' : 'deducted automatically (oldest first, one-off up to PLN 5M, else 50% a year, 5 years)'} — change in Settings.
    Not tax advice — check against your broker's PIT-8C.${excludedNote}</div>
  ${tax.warnings.length ? `<div class="alert"><ul>${tax.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
  <div class="card"><div class="card-head"><h3>Tax year</h3><div class="row gap wrap"><div class="seg" id="yearSeg">${tax.years.map((x) => `<button class="${x.year === y.year ? 'on' : ''}" data-y="${x.year}">${x.year}</button>`).join('')}</div>
    <button class="btn sm-btn no-print" id="taxCsv">Export CSV</button><button class="btn sm-btn no-print" id="taxPrint">Print / PDF</button></div></div>
    <div class="print-only"><h2>PIT-38 ${y.year} — estimate</h2><p class="small">Generated ${new Date().toLocaleString()} · FIFO, NBP rates · not tax advice</p></div>
    <div class="kpis">
      ${kpi('Przychód (revenue)', P(y.proceeds), 'PIT-38 sec. C, field 22')}
      ${kpi('Koszty (costs)', P(y.costs), 'field 23')}
      ${kpi(y.income >= 0 ? 'Dochód (income)' : 'Strata (loss)', `<span class="${cls(y.income)}">${P(y.income)}</span>`, y.income >= 0 ? 'field 24' : 'field 25 — carry forward')}
      ${y.lossDeducted ? kpi('Prior losses deducted', P(y.lossDeducted), y.lossDeductions.map((l) => `${l.fromYear}${l.oneOff ? ' (one-off)' : ''}: ${P(l.amount)}`).join(' · ') + ' — field 28') : ''}
      ${kpi('Podatek 19% (tax)', `<b>${P(y.tax)}</b>`, `base ${P(y.taxBase)} rounded`)}
      ${kpi('Foreign dividends: tax to pay', `<b>${P(y.divToPayRounded)}</b>`, `sec. G · gross ${P(y.divGross)}, withheld ${P(y.divWithheld)}`)}
      ${kpi('Total due', `<b>${P(y.tax + y.divToPayRounded)}</b>`)}
    </div>
  </div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>By country</h3><span class="muted small">helps with PIT/ZG</span></div><div id="taxCountries"></div></div>
    <div class="card"><div class="card-head"><h3>Losses to carry forward</h3><a class="link" href="#/settings">settings →</a></div><div id="taxLosses"></div></div>
  </div>
  <div class="card"><div class="card-head"><h3>Sales (${y.trades.length})</h3></div><div id="taxTrades"></div></div>
  <div class="card"><div class="card-head"><h3>Dividends (${y.dividends.length})</h3></div><div id="taxDivs"></div></div>`;
  $('#taxCsv').addEventListener('click', () => download(`pit38-${y.year}.csv`, taxReportCSV(y), 'text/csv'));
  $('#taxPrint').addEventListener('click', () => window.print());
  $('#yearSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (b) { history.replaceState(null, '', `#/taxes?y=${b.dataset.y}`); taxes(el, ctx); } });
  table($('#taxCountries'), y.countries, [
    { key: 'country', label: tr('Country') },
    { key: 'income', label: tr('Gains'), cls: 'num', render: (c) => `<span class="${cls(c.income)}">${P(c.income)}</span>` },
    { key: 'divGross', label: tr('Dividends'), cls: 'num', render: (c) => P(c.divGross) },
    { key: 'divWithheld', label: tr('Tax abroad'), cls: 'num', render: (c) => P(c.divWithheld) },
    { key: 'divToPay', label: tr('To pay in PL'), cls: 'num', render: (c) => P(c.divToPay) },
  ], { sortKey: 'country', sortDir: 1, empty: 'Nothing this year.' });
  const usable = tax.losses.filter((l) => l.remaining > 0.5 && +l.year <= +y.year && +l.expires >= +y.year); // losses that exist in the selected year
  table($('#taxLosses'), usable, [
    { key: 'year', label: tr('Loss year') },
    { key: 'original', label: tr('Loss'), cls: 'num', render: (l) => P(l.original) },
    { key: 'remaining', label: tr('Still deductible'), cls: 'num', render: (l) => P(l.remaining) },
    { key: 'expires', label: tr('Usable until') },
  ], { sortKey: 'year', sortDir: 1, empty: st.taxCarryForward === false ? 'Carry-forward is switched off in Settings.' : 'No unused losses.' });
  table($('#taxTrades'), y.trades, [
    { key: 'date', label: tr('Sold'), render: (t) => fmtDate(t.date) },
    { key: 'ticker', label: tr('Ticker'), render: (t) => `<b>${esc(t.ticker)}</b>` },
    { key: 'qty', label: tr('Qty'), cls: 'num', render: (t) => qty(t.qty) },
    { key: 'rate', label: tr('NBP rate'), cls: 'num', render: (t) => (t.currency === 'PLN' ? '—' : `${num(t.rate, 4)} ${t.currency}`) },
    { key: 'buys', label: tr('Bought (FIFO)'), render: (t) => `<span class="small muted">${t.buys.map((b) => `${qty(b.qty)} @ ${num(b.price, 4)} on ${b.date}${t.currency !== 'PLN' ? ` (×${num(b.rate, 4)})` : ''}`).join('<br>')}</span>` },
    { key: 'proceeds', label: tr('Revenue'), cls: 'num', render: (t) => P(t.proceeds) },
    { key: 'costs', label: tr('Costs'), cls: 'num', render: (t) => P(t.costs) },
    { key: 'income', label: tr('Income'), cls: 'num', render: (t) => `<span class="${cls(t.income)}">${P(t.income)}</span>` },
  ], { sortKey: 'date', sortDir: 1, empty: 'No sales this year.' });
  table($('#taxDivs'), y.dividends, [
    { key: 'date', label: tr('Date'), render: (d) => fmtDate(d.date) },
    { key: 'ticker', label: tr('Ticker'), render: (d) => `<b>${esc(d.ticker || '')}</b>${d.domestic ? ' <span class="tag">PL — taxed at source</span>' : ''}` },
    { key: 'rate', label: tr('NBP rate'), cls: 'num', render: (d) => (d.domestic ? '—' : `${num(d.rate, 4)} ${d.currency}`) },
    { key: 'gross', label: tr('Gross'), cls: 'num', render: (d) => P(d.gross) },
    { key: 'withheld', label: tr('Withheld'), cls: 'num', render: (d) => P(d.withheld) },
    { key: 'toPay', label: tr('To pay in PL'), cls: 'num', render: (d) => P(d.toPay) },
  ], { sortKey: 'date', sortDir: 1, empty: 'No recorded dividends this year (estimated dividends are not used for tax).' });
}
