// dashboard page — split from the former views.js
import { addDays, todayISO, periodStats, forecastDividends, groupBy, DEFAULT_LIMITS, contributionsByYear, rebalancePlan } from '../engine.js';
import { loadEvents } from '../data.js';
import { t as tr } from '../i18n.js';
import { masterChart } from '../masterchart.js';
import { getConfig as getSyncConfig } from '../sync.js';
import { $, esc, money, num, pct, cls, fmtDate, kpi, chart } from '../ui.js';
import { analysis } from './analysis.js';
import { calendar } from './calendar.js';
import { doughnut, emptyState, short, warningsBlock } from './common.js';
import { rebalance } from './rebalance.js';
import { settings } from './settings.js';
import { watchlist } from './watchlist.js';


export async function dashboard(el, ctx) {
  const { result: r, base, market } = ctx;
  if (!ctx.txs.length) return emptyState(el, ctx);
  const t = r.totals;
  const today = r.today;
  const forecast = forecastDividends(r.holdings, market, base, today);
  const fwdDiv = forecast.reduce((s, f) => s + f.amountBase, 0);
  const div12 = r.dividends.filter((d) => d.date > addDays(today, -365)).reduce((s, d) => s + d.netBase, 0);

  el.innerHTML = `
  ${backupReminder(ctx)}
  ${alertsBlock(ctx)}
  ${warningsBlock(ctx)}
  ${driftAlert(ctx)}
  <div class="kpis">
    ${kpi('Portfolio value', money(t.value, base), t.cashValue ? `incl. cash ${money(t.cashValue, base)}` : `${r.holdings.length} positions`)}
    ${kpi('Total profit', `<span class="${cls(t.profit)}">${money(t.profit, base, { sign: true })}</span>`, `net invested ${money(t.invested, base)}`)}
    ${kpi('Today', `<span class="${cls(t.dayChange)}">${money(t.dayChange, base, { sign: true })}</span>`, pct(t.dayChangePct), cls(t.dayChange))}
    ${kpi('Return (TWR)', `<span class="${cls(t.twr)}">${pct(t.twr)}</span>`, 'time-weighted, since start')}
    ${kpi('Annual return (XIRR)', `<span class="${cls(t.xirr)}">${pct(t.xirr)}</span>`, 'money-weighted, p.a.')}
    ${kpi('Dividends', money(div12, base), `last 12m · next 12m ≈ ${money(fwdDiv, base, { compact: true })}`)}
  </div>
  <div class="card">
    <div class="card-head"><h3>Returns by period</h3></div>
    <div class="periods" id="periods"></div>
  </div>
  ${accountsCard(ctx)}
  <div id="masterHost"></div>
  <div class="grid-2-1">
    <div class="card">
      <div class="card-head"><h3>Allocation</h3><a href="#/analysis" class="link">details →</a></div>
      <div class="grid-2 alloc-inner"><div class="chart-box small"><canvas id="allocChart"></canvas></div><div id="allocLegend" class="legend-list"></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Today's movers</h3></div>
      <div id="movers"></div>
      <div class="card-head" style="margin-top:14px"><h3>Upcoming events</h3><a href="#/calendar" class="link">calendar →</a></div>
      <div id="upcoming" class="upcoming"></div>
    </div>
  </div>`;

  // periods strip
  const pr = [['1D', addDays(today, -1)], ['1W', addDays(today, -7)], ['1M', addDays(today, -30)], ['3M', addDays(today, -91)],
    ['YTD', `${+today.slice(0, 4) - 1}-12-31`], ['1Y', addDays(today, -365)], ['3Y', addDays(today, -1096)], ['Max', '0000-00-00']];
  $('#periods').innerHTML = pr.map(([label, from]) => {
    const p = periodStats(r.series, from);
    return `<div class="period"><div class="p-label">${label}</div><div class="p-val ${cls(p?.twr)}">${pct(p?.twr)}</div><div class="p-sub ${cls(p?.profit)}">${money(p?.profit, base, { sign: true, compact: true })}</div></div>`;
  }).join('');

  // allocation
  const alloc = groupBy([...r.holdings, ...(t.cashValue > 0 ? [{ ticker: 'Cash', value: t.cashValue }] : [])], (h) => h.ticker);
  doughnut($('#allocChart'), $('#allocLegend'), alloc.slice(0, 8).concat(alloc.length > 8 ? [{ label: tr('Other'), value: alloc.slice(8).reduce((s, a) => s + a.value, 0), weight: alloc.slice(8).reduce((s, a) => s + a.weight, 0) }] : []), base);

  // movers
  const movers = [...r.holdings].filter((h) => h.prevClose).sort((a, b) => Math.abs(b.dayChangePct) - Math.abs(a.dayChangePct)).slice(0, 5);
  $('#movers').innerHTML = movers.length ? movers.map((h) => `<div class="mini-row"><span><b>${esc(h.ticker)}</b> <span class="muted">${esc(short(h.name))}</span></span>
    <span class="${cls(h.dayChangePct)}">${pct(h.dayChangePct)} <span class="muted">${money(h.dayChange, base, { sign: true })}</span></span></div>`).join('') : '<div class="muted">No price changes.</div>';

  // upcoming
  const held = new Set(r.holdings.map((h) => h.ticker));
  const { events } = await loadEvents();
  await masterChart($('#masterHost'), ctx, events);
  const until = addDays(today, 30);
  const up = events.filter((e) => held.has(e.ticker) && e.date >= today && e.date <= until).slice(0, 8);
  $('#upcoming').innerHTML = up.length ? up.map((e) => `<div class="mini-row"><span><span class="tag ${e.type}">${e.type}</span> <b>${esc(e.ticker)}</b></span><span class="muted">${fmtDate(e.date)}</span></div>`).join('') : '<div class="muted">Nothing in the next 30 days.</div>';
}

export function accountsCard(ctx) {
  const accts = ctx.state.portfolios.filter((p) => (p.type === 'IKE' || p.type === 'IKZE') && (ctx.selected === 'all' || ctx.selected === p.id));
  if (!accts.length) return '';
  const year = ctx.result.today.slice(0, 4);
  const st = ctx.settings;
  const limit = (kind) => (st.limits?.[kind]?.[year] ?? DEFAULT_LIMITS[kind][year] ?? null) * (kind === 'IKZE' && st.ikzeSelfEmployed ? 1.5 : 1);
  const rows = accts.map((p) => {
    const { byYear, method } = contributionsByYear(ctx.state.transactions, p.id, ctx.market);
    const paid = byYear[year] || 0, lim = limit(p.type);
    const left = lim ? Math.max(0, lim - paid) : null;
    const over = lim && paid > lim + 0.5;
    const ded = p.type === 'IKZE' ? `<div class="muted small">PIT deduction on ${money(Math.min(paid, lim || paid), 'PLN', { digits: 0 })}: ≈ ${money(Math.min(paid, lim || paid) * 0.12, 'PLN', { digits: 0 })} at 12% · ${money(Math.min(paid, lim || paid) * 0.32, 'PLN', { digits: 0 })} at 32% · ${money(Math.min(paid, lim || paid) * 0.19, 'PLN', { digits: 0 })} at 19% (linear). Withdrawal after 65 is taxed at a flat 10%.</div>` : '';
    return `<div class="acct"><div class="row gap wrap"><b>${esc(p.name)}</b><span class="tag">${p.type}</span><span class="grow"></span>
      <span>${money(paid, 'PLN')} ${lim ? `of ${money(lim, 'PLN', { digits: 0 })}` : ''}</span></div>
      ${lim ? `<div class="bar big"><i style="width:${Math.min(100, (paid / lim) * 100).toFixed(1)}%;${over ? 'background:var(--neg)' : ''}"></i></div>` : ''}
      <div class="small ${over ? 'neg' : 'muted'}">${over ? `Over the ${year} limit by ${money(paid - lim, 'PLN')} — the excess must be returned.` : lim ? `${money(left, 'PLN')} left for ${year}` : `No ${year} limit set (Settings)`} · counted from ${method}${(byYear[+year - 1]) ? ` · ${+year - 1}: ${money(byYear[+year - 1], 'PLN', { digits: 0 })}` : ''}</div>${ded}</div>`;
  }).join('');
  return `<div class="card"><div class="card-head"><h3>Retirement accounts ${year}</h3><a href="#/settings" class="link">limits →</a></div>${rows}</div>`;
}

/** Price alerts that have been hit (latest close vs. threshold); also fires a browser notification once a day. */
export function triggeredAlerts(ctx) {
  return (ctx.settings.alerts || []).map((a) => {
    const px = ctx.market.lastPrice(a.ticker) ?? ctx.quotes[a.ticker]?.price;
    return { ...a, now: px, hit: px !== null && px !== undefined && (a.op === 'above' ? px >= a.price : px <= a.price) };
  }).filter((a) => a.hit);
}

export function alertsBlock(ctx) {
  const hits = triggeredAlerts(ctx);
  if (!hits.length) return '';
  try {
    const today = todayISO(), key = 'scrabfree_notified';
    const seen = JSON.parse(localStorage.getItem(key) || '{}');
    if (window.Notification && Notification.permission === 'granted') {
      for (const a of hits) if (seen[a.id] !== today) { new Notification(`${a.ticker} is ${a.op} ${a.price}`, { body: `Last price ${a.now}`, icon: 'icon.svg' }); seen[a.id] = today; }
      localStorage.setItem(key, JSON.stringify(seen));
    }
  } catch { /* notifications are optional */ }
  return `<div class="alert info">🔔 ${hits.map((a) => `<b>${esc(a.ticker)}</b> is ${a.op} ${num(a.price, 4)} (now ${num(a.now, 4)})`).join(' · ')} — <a href="#/watchlist">manage alerts</a></div>`;
}

export function backupReminder(ctx) {
  if (getSyncConfig()?.gistId || ctx.state.transactions.length < 3) return '';
  const last = ctx.settings.lastBackupAt;
  const days = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  if (days !== null && days < 30) return '';
  return `<div class="alert">Your portfolio lives only in this browser. ${days === null ? 'You have never exported a backup.' : `Last backup was ${days} days ago.`}
    <a href="#/settings">Export a backup or turn on sync →</a></div>`;
}

/** Dashboard hint when targets exist and something drifted more than 5 percentage points. */
export function driftAlert(ctx) {
  const targets = ctx.settings.targets?.[ctx.selected];
  if (!targets || !Object.keys(targets).length) return '';
  const rows = ctx.result.holdings.map((h) => ({ key: h.ticker, value: h.value, unitPrice: null }));
  const worst = rebalancePlan(rows, targets, { mode: 'full', wholeShares: false }).items.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0];
  return worst && Math.abs(worst.drift) > 0.05 ? `<div class="alert info">${esc(worst.key)} is ${num(Math.abs(worst.drift) * 100, 1)} pp ${worst.drift > 0 ? 'above' : 'below'} its target weight. <a href="#/rebalance">Rebalance →</a></div>` : '';
}
