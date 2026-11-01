// transactions page — split from the former views.js
import { TX_TYPES, todayISO, Series } from '../engine.js';
import { loadHistories } from '../data.js';
import { parseCSV, detectColumns, rowsToTransactions, toCSV, FIELDS, txFingerprint, gpwTicker } from '../importers.js';
import { store } from '../store.js';
import { t as tr } from '../i18n.js';
import { detectBroker, PARSERS, BROKER_NAMES } from '../brokers.js';
import { $, $$, esc, money, num, qty, fmtDate, toast, download, readFile, table } from '../ui.js';
import { modal, short } from './common.js';
import { bondForm, customForm } from './holdings.js';


export function txTable(el, txs, ctx, { compact = false } = {}) {
  const cols = [
    { key: 'date', label: tr('Date'), render: (t) => fmtDate(t.date) },
    ...(compact || ctx.state.portfolios.length < 2 ? [] : [{ key: 'portfolioId', label: tr('Portfolio'), render: (t) => esc(ctx.portfolioName(t.portfolioId)) }]),
    { key: 'type', label: tr('Type'), render: (t) => `<span class="tag ${t.type.toLowerCase()}">${t.type}</span>` },
    { key: 'ticker', label: tr('Ticker'), render: (t) => `<b>${esc(t.ticker || '')}</b>` },
    { key: 'quantity', label: tr('Qty'), cls: 'num', render: (t) => (t.quantity ? qty(t.quantity) : '') },
    { key: 'price', label: tr('Price'), cls: 'num', render: (t) => (t.price ? money(t.price, t.currency) : '') },
    { key: 'total', label: tr('Total'), cls: 'num', sort: (t) => txTotal(t), render: (t) => money(txTotal(t), t.currency) + (t.settleCurrency ? `<div class="small muted">${money(t.settleAmount, t.settleCurrency)}</div>` : '') + (t.type === 'CONVERSION' ? `<div class="small muted">→ ${money(t.toAmount, t.toCurrency)}</div>` : '') + (t.toTicker && t.type !== 'CONVERSION' ? `<div class="small muted">→ ${esc(t.toTicker)} ×${num(t.ratio, 4)}${t.type === 'SPINOFF' ? ` · ${num(t.costPct, 1)}% cost` : ''}</div>` : '') },
    { key: 'fee', label: tr('Fee / tax'), cls: 'num', sort: (t) => (t.fee || t.tax || 0), render: (t) => (t.fee || t.tax ? money(t.fee || t.tax, t.currency) : '') },
    ...(compact ? [] : [{ key: 'note', label: tr('Note'), render: (t) => `<span class="muted small">${esc(short(t.note || '', 30))}</span>` },
      { key: 'actions', label: '', render: (t) => `<button class="icon-btn" data-edit="${esc(t.id)}" title="Edit">✎</button><button class="icon-btn" data-del="${esc(t.id)}" title="Delete">🗑</button>` }]),
  ];
  table(el, txs, cols, { sortKey: 'date', empty: 'No transactions match.' });
  el.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) txForm(ctx, store.get().transactions.find((t) => t.id === ed.dataset.edit));
    if (del && confirm('Delete this transaction?')) store.deleteTransactions([del.dataset.del]);
  });
}

export function txTotal(t) {
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
        <button class="btn" id="addBond">+ Treasury bonds</button>
        <button class="btn" id="addCustom">+ Other asset</button>
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
  $('#addBond').addEventListener('click', () => bondForm(ctx));
  $('#addCustom').addEventListener('click', () => customForm(ctx));
  $('#impTx').addEventListener('click', () => importDialog(ctx));
  $('#expTx').addEventListener('click', () => download(`transactions-${todayISO()}.csv`, toCSV(ctx.txs, ctx.state.portfolios), 'text/csv'));
  draw();
  if (params.get('add')) { history.replaceState(null, '', '#/transactions'); txForm(ctx); }
  if (params.get('import')) { history.replaceState(null, '', '#/transactions'); importDialog(ctx); }
  if (params.get('bond')) { history.replaceState(null, '', '#/transactions'); bondForm(ctx); }
}

export function txForm(ctx, tx = null) {
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
      <label data-f="toTicker">New ticker<input name="toTicker" value="${esc(tx?.toTicker || '')}" placeholder="e.g. the merged or spun-off company" style="text-transform:uppercase" list="tickerList"></label>
      <label data-f="ratio">New shares per old share<input type="number" step="any" min="0" name="ratio" value="${tx?.ratio ?? ''}" placeholder="e.g. 0.5"></label>
      <label data-f="costPct">Cost moved to the new company (%)<input type="number" step="any" min="0" max="100" name="costPct" value="${tx?.costPct ?? ''}" placeholder="from the company's announcement"></label>
      <label data-f="to">Received amount<input type="number" step="any" min="0" name="toAmount" value="${tx?.toAmount ?? ''}"></label>
      <label data-f="to">Received currency<input name="toCurrency" maxlength="3" value="${esc(tx?.toCurrency || '')}" style="text-transform:uppercase" placeholder="USD"></label>
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
  const FIELDS_BY_TYPE = { BUY: ['ticker', 'quantity', 'price', 'fee', 'settle'], SELL: ['ticker', 'quantity', 'price', 'fee', 'settle'], DIVIDEND: ['ticker', 'amount', 'tax', 'settle'], CONVERSION: ['amount', 'to'], MERGER: ['ticker', 'toTicker', 'ratio'], SPINOFF: ['ticker', 'toTicker', 'ratio', 'costPct'] };
  const sync = () => {
    const type = f.type.value;
    const show = FIELDS_BY_TYPE[type] || ['amount'];
    $$('[data-f]', f).forEach((l) => { l.hidden = !show.includes(l.dataset.f); });
    $('[data-amount-label]', f).textContent = type === 'DIVIDEND' ? 'Gross amount' : type === 'CONVERSION' ? 'Amount sold' : 'Amount';
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
      if (k === 'toTicker') { out.toTicker = (fd.toTicker || '').trim().toUpperCase(); continue; }
      if (k === 'to') {
        out.toAmount = +fd.toAmount || 0; out.toCurrency = (fd.toCurrency || '').trim().toUpperCase();
        if (!out.toAmount || !out.toCurrency) return toast('Received amount and currency are required', 'error');
        continue;
      }
      if (k === 'settle') {
        const sc = (fd.settleCurrency || '').trim().toUpperCase();
        if (sc && sc !== out.currency && +fd.settleAmount > 0) { out.settleCurrency = sc; out.settleAmount = +fd.settleAmount; }
        continue;
      }
      if (fd[k] !== '' && fd[k] !== undefined) out[k] = +fd[k];
    }
    if ((type === 'BUY' || type === 'SELL') && (!out.ticker || !out.quantity || out.price === undefined)) return toast('Ticker, quantity and price are required', 'error');
    if (type === 'MERGER' || type === 'SPINOFF') {
      if (!out.ticker || !out.toTicker || !(out.ratio > 0)) return toast('Old ticker, new ticker and ratio are required', 'error');
      if (type === 'SPINOFF' && out.costPct === undefined) return toast('Enter the cost share (%) for the new company', 'error');
    } else if (!want.includes('quantity') && !out.amount) return toast('Amount is required', 'error');
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

export const SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

export function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

/** Read a CSV/TXT/XLSX file into candidate tables: [{ name, rows }] */
export async function fileToTables(file) {
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

export function importDialog(ctx) {
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
    for (const sym of symbols) if (!(sym in symMap)) symMap[sym] = saved[sym] || gpwTicker(sym) || (sym.startsWith('ISIN:') ? '' : sym);
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

export const r4 = (x) => Math.round(x * 1e4) / 1e4;
