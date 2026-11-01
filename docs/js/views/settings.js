// settings page — split from the former views.js
import { todayISO, ACCOUNT_TYPES, DEFAULT_LIMITS } from '../engine.js';
import { store } from '../store.js';
import { getConfig as getSyncConfig, connect as connectSync, disconnect as disconnectSync, syncNow } from '../sync.js';
import { $, esc, money, toast, download, readFile } from '../ui.js';
import { loadDemo } from './common.js';
import { dividends } from './dividends.js';
import { transactions } from './transactions.js';


export async function settings(el, ctx) {
  const s = ctx.state;
  const st = s.settings;
  const bare = (t) => t.replace(/^ISIN:/, ''); // tickers.json accepts ISINs; the workflow resolves them
  const wanted = [...new Set([...(ctx.meta.tickers || []), ...Object.keys(ctx.meta.isins || {}), ...ctx.missing.map(bare), ...(st.watchlist || []).filter((t) => !ctx.meta.files?.[t])])].sort();
  const needsAdding = wanted.filter((t) => !(ctx.meta.tickers || []).includes(t) && !(ctx.meta.isins || {})[t]);
  el.innerHTML = `
  <div class="grid-2">
    <div class="card">
      <h3>General</h3>
      <div class="form">
        <label>Language<select id="sLang"><option value="">Auto (browser)</option><option value="en">English</option><option value="pl">Polski</option></select></label>
        <label>Base currency<select id="sBase">${['USD', ...Object.keys(ctx.fx)].sort().map((c) => `<option ${c === ctx.base ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="check full"><input type="checkbox" id="sAuto" ${st.autoDividends ? 'checked' : ''}> Estimate dividends from market data for tickers without recorded dividends</label>
      </div>
      <h3 class="mt">Portfolios</h3>
      <div id="pfList"></div>
      <form id="pfAdd" class="row gap mt"><input name="n" placeholder="New portfolio name (e.g. IKE, XTB, mBank)" required class="grow"><button class="btn">Add</button></form>
      <h3 class="mt">IKE / IKZE limits</h3>
      <p class="muted small">Annual contribution limits in PLN. Edit if the official figure differs.</p>
      <div class="form"><label>Year<select id="limYear">${Object.keys({ ...DEFAULT_LIMITS.IKE, ...(st.limits?.IKE || {}) }).sort().reverse().map((y) => `<option>${y}</option>`).join('')}</select></label>
        <span></span><label>IKE limit<input type="number" step="any" id="limIKE"></label><label>IKZE limit<input type="number" step="any" id="limIKZE"></label>
        <label class="check full"><input type="checkbox" id="limSelf" ${st.ikzeSelfEmployed ? 'checked' : ''}> I am self-employed (IKZE limit × 1.5)</label></div>
    </div>
    <div class="card">
      <h3>Backup &amp; data</h3>
      <p class="muted small">Everything you enter is stored only in this browser (localStorage). Export a backup regularly — clearing browser data deletes it. Import the file on another device to sync.</p>
      <div class="row gap wrap">
        <button class="btn primary" id="bExp">Export backup (JSON)</button>
        <label class="btn">Import backup<input type="file" id="bImp" accept=".json,application/json" hidden></label>
        <label class="check"><input type="checkbox" id="bMerge"> merge instead of replace</label>
      </div>
      <div class="row gap wrap mt">
        <button class="btn" id="bDemo">Load demo portfolio</button>
        <button class="btn danger" id="bReset">Erase all data</button>
      </div>
      <p class="muted small mt">${s.transactions.length} transactions in ${s.portfolios.length} portfolio(s).</p>
      <h3 class="mt">Sync between devices</h3>
      <div id="syncBox"></div>
    </div>
  </div>
  <div class="card">
    <h3>Market data</h3>
    <p class="muted small">Prices, FX and events come from Yahoo Finance and NBP via a GitHub Action that runs on weekdays and publishes them with the site.
      Last update: <b>${ctx.meta.generated_at ? new Date(ctx.meta.generated_at).toLocaleString() : 'never'}</b>. Tracked: ${(ctx.meta.tickers || []).length} tickers.</p>
    ${needsAdding.length ? `<div class="alert">These tickers need market data: <b>${needsAdding.map(esc).join(', ')}</b>. Replace <code>tickers.json</code> with the list below, then run the workflow.</div>` : '<p class="pos">All your tickers are tracked. ✓</p>'}
    <textarea readonly rows="4" id="tjson">${esc(JSON.stringify(wanted, null, 4))}</textarea>
    <div class="row gap wrap">
      <button class="btn" id="copyT">Copy tickers.json</button>
      <a class="btn" target="_blank" rel="noopener" href="${ctx.repoUrl}/edit/main/tickers.json">Edit tickers.json on GitHub</a>
      <a class="btn" target="_blank" rel="noopener" href="${ctx.repoUrl}/actions/workflows/deploy.yml">Run data refresh</a>
    </div>
  </div>
  <div class="card">
    <h3>Taxes</h3>
    <div class="form">
      <label>Exchange-rate date for trades<select id="tDate"><option value="trade">Trade date (NBP rate from the day before)</option><option value="settlement">Settlement date T+2</option></select></label>
      <label class="check"><input type="checkbox" id="tCarry" ${st.taxCarryForward !== false ? 'checked' : ''}> Deduct prior-year losses automatically</label>
      <label class="check full"><input type="checkbox" id="tWht" ${st.estimateWithholding !== false ? 'checked' : ''}> Estimated dividends: subtract typical withholding tax of the issuer's country (US 15%, DE 26.4%, CH 35%, PL 19%…)</label>
      <label class="full">Losses from years before your data (PLN), e.g. <code>2022: 1500, 2023: 300</code><input id="tPrior" value="${esc(Object.entries(st.taxPriorLosses || {}).map(([y, v]) => `${y}: ${v}`).join(', '))}"></label>
    </div>
  </div>
  <div class="card">
    <h3>Manual prices</h3>
    <p class="muted small">For assets without Yahoo data (bonds, private funds, delisted stocks). Used whenever no market price exists.</p>
    <div id="mpList"></div>
    <form id="mpAdd" class="row gap wrap mt"><input name="t" placeholder="Ticker" required class="sm"><input name="p" type="number" step="any" placeholder="Price" required class="sm"><input name="c" placeholder="Currency" maxlength="3" value="${esc(ctx.base)}" class="sm" required><button class="btn">Save</button></form>
  </div>`;

  $('#sBase').addEventListener('change', (e) => store.setSettings({ baseCurrency: e.target.value }));
  $('#sLang').value = st.lang || '';
  $('#sLang').addEventListener('change', (e) => { store.setSettingsQuiet({ lang: e.target.value }); location.reload(); });
  const limits = (kind, y) => st.limits?.[kind]?.[y] ?? DEFAULT_LIMITS[kind][y] ?? '';
  const showLim = () => { const y = $('#limYear').value; $('#limIKE').value = limits('IKE', y); $('#limIKZE').value = limits('IKZE', y); };
  $('#limYear').addEventListener('change', showLim); showLim();
  ['IKE', 'IKZE'].forEach((k) => $(`#lim${k}`).addEventListener('change', (e) => {
    const y = $('#limYear').value, cur = st.limits || {};
    store.setSettings({ limits: { ...cur, [k]: { ...(cur[k] || {}), [y]: +e.target.value } } });
  }));
  $('#limSelf').addEventListener('change', (e) => store.setSettings({ ikzeSelfEmployed: e.target.checked }));
  $('#sAuto').addEventListener('change', (e) => store.setSettings({ autoDividends: e.target.checked }));
  $('#tDate').value = st.taxDateMode || 'trade';
  $('#tDate').addEventListener('change', (e) => store.setSettings({ taxDateMode: e.target.value }));
  $('#tCarry').addEventListener('change', (e) => store.setSettings({ taxCarryForward: e.target.checked }));
  $('#tWht').addEventListener('change', (e) => store.setSettings({ estimateWithholding: e.target.checked }));
  $('#tPrior').addEventListener('change', (e) => {
    const out = {};
    for (const m of e.target.value.matchAll(/(\d{4})\s*[:=]\s*([\d\s.,]+)/g)) out[m[1]] = parseFloat(m[2].replace(/\s/g, '').replace(',', '.'));
    store.setSettings({ taxPriorLosses: out });
    toast(`Saved ${Object.keys(out).length} prior loss(es)`);
  });
  $('#pfList').innerHTML = s.portfolios.map((p) => `<div class="mini-row"><span><b>${esc(p.name)}</b> <span class="muted small">${s.transactions.filter((t) => t.portfolioId === p.id).length} tx</span></span>
    <span class="row gap"><select class="sm" data-ptype="${esc(p.id)}" title="Account type">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${(p.type || 'regular') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <button class="icon-btn" data-ren="${esc(p.id)}" title="Rename">✎</button>${s.portfolios.length > 1 ? `<button class="icon-btn" data-delp="${esc(p.id)}" title="Delete">🗑</button>` : ''}</span></div>`).join('');
  $('#pfList').addEventListener('change', (e) => { const sel = e.target.closest('[data-ptype]'); if (sel) store.setPortfolioType(sel.dataset.ptype, sel.value); });
  $('#pfList').addEventListener('click', (e) => {
    const r = e.target.closest('[data-ren]'), d = e.target.closest('[data-delp]');
    if (r) { const n = prompt('New name', ctx.portfolioName(r.dataset.ren)); if (n) store.renamePortfolio(r.dataset.ren, n.trim()); }
    if (d && confirm(`Delete portfolio "${ctx.portfolioName(d.dataset.delp)}" and all its transactions?`)) store.deletePortfolio(d.dataset.delp);
  });
  $('#pfAdd').addEventListener('submit', (e) => { e.preventDefault(); store.addPortfolio(e.target.n.value.trim()); toast('Portfolio added'); });
  $('#bExp').addEventListener('click', () => { download(`portfolio-backup-${todayISO()}.json`, store.exportJSON(), 'application/json'); store.markBackup(); });
  drawSync($('#syncBox'));
  $('#bImp').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const merge = $('#bMerge').checked;
      if (!merge && s.transactions.length && !confirm('Replace all current data with this backup?')) return;
      store.importJSON(await readFile(f), { merge });
      toast('Backup imported');
    } catch (err) { toast('Import failed: ' + err.message, 'error'); }
  });
  $('#bDemo').addEventListener('click', loadDemo);
  $('#bReset').addEventListener('click', () => { if (confirm('Erase all portfolios and transactions from this browser? Export a backup first!')) { store.reset(); toast('All data erased'); } });
  $('#copyT').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#tjson').value); toast('Copied'); } catch { $('#tjson').select(); } });
  const mp = st.manualPrices || {};
  $('#mpList').innerHTML = Object.entries(mp).map(([t, v]) => `<div class="mini-row"><span><b>${esc(t)}</b></span><span>${money(v.price, v.currency)} <button class="icon-btn" data-rmp="${esc(t)}">✕</button></span></div>`).join('') || '<div class="muted small">None.</div>';
  $('#mpList').addEventListener('click', (e) => { const b = e.target.closest('[data-rmp]'); if (b) { const m = { ...mp }; delete m[b.dataset.rmp]; store.setSettings({ manualPrices: m }); } });
  $('#mpAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    store.setSettings({ manualPrices: { ...mp, [f.t.value.trim().toUpperCase()]: { price: +f.p.value, currency: f.c.value.trim().toUpperCase() } } });
  });
}

export function drawSync(box) {
  const cfg = getSyncConfig();
  if (cfg?.gistId) {
    box.innerHTML = `<p class="small">Connected${cfg.login ? ` as <b>${esc(cfg.login)}</b>` : ''} · private gist <code>${esc(cfg.gistId.slice(0, 8))}…</code> · ${cfg.passphrase ? '🔒 encrypted' : '⚠ not encrypted'}<br>
      <span class="muted">Last sync: ${cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'never'}</span>${cfg.error ? `<br><span class="neg">${esc(cfg.error)}</span>` : ''}</p>
      <div class="row gap wrap"><button class="btn" id="syNow">Sync now</button><button class="btn danger" id="syOff">Disconnect this device</button></div>`;
    $('#syNow', box).addEventListener('click', async () => {
      try { await syncNow(store); toast('Synced'); } catch (e) { toast(e.message, 'error'); }
      drawSync(box);
    });
    $('#syOff', box).addEventListener('click', () => { if (confirm('Stop syncing on this device? Your data stays here and in the gist.')) { disconnectSync(); drawSync(box); } });
    return;
  }
  box.innerHTML = `<p class="muted small">Keep the portfolio in a <b>private GitHub Gist</b> and sync it automatically on every device. Create a token with only the
    <code>gist</code> scope (<a target="_blank" rel="noopener" href="https://github.com/settings/tokens/new?scopes=gist&description=Portfolio%20sync">create token</a>) and use the same token + passphrase on each device.
    With a passphrase everything is encrypted in your browser before upload.</p>
    <form id="syForm" class="form"><label>GitHub token<input name="t" type="password" required autocomplete="off" placeholder="ghp_…"></label>
    <label>Encryption passphrase (recommended)<input name="p" type="password" autocomplete="new-password"></label>
    <div class="full row gap"><button class="btn primary">Connect</button><span class="muted small">The token and passphrase are stored only in this browser.</span></div></form>`;
  $('#syForm', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target); btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      const r = await connectSync(e.target.t.value.trim(), e.target.p.value, store);
      toast(r.created ? 'Created a private gist and uploaded your portfolio' : 'Connected and merged with your other devices');
    } catch (err) { toast(err.message, 'error'); }
    drawSync(box);
  });
}
