// goals page — split from the former views.js
import { forecastDividends } from '../engine.js';
import { store } from '../store.js';
import { t as tr, locale } from '../i18n.js';
import { project, monthsToGoal, fireNumber, monthlyNeeded } from '../goals.js';
import { $, $$, money, num, pct, kpi, chart, cssVar } from '../ui.js';
import { lineOpts } from './common.js';
import { dividends } from './dividends.js';


export async function goals(el, ctx) {
  const { result: r, base, market } = ctx;
  const saved = ctx.settings.goal || {};
  const { dates, twr } = r.series;
  const yrs = dates.length ? (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365.25 * 864e5) : 0;
  const cagr = yrs > 1 ? Math.pow(twr[twr.length - 1], 1 / yrs) - 1 : null;
  const fwdDiv = forecastDividends(r.holdings, market, base, r.today).reduce((a, f) => a + f.amountBase, 0);
  const divYield = r.totals.holdingsValue ? fwdDiv / r.totals.holdingsValue : 0;
  const g = {
    kind: 'fire', amount: 1000000, income: 6000, swr: 4, monthly: 2000, ret: cagr !== null ? Math.round(Math.min(10, Math.max(2, cagr * 100)) * 10) / 10 : 6,
    infl: 3, growth: 0, start: Math.round(r.totals.value), years: 30, ...saved,
  };
  el.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>Goal</h3><span class="muted small">projections are in today's money (after inflation)</span></div>
    <form id="gf" class="form goal-form">
      <label>Goal type<select name="kind">
        <option value="fire">Financial independence (live off the portfolio)</option>
        <option value="dividends">Monthly dividend income</option>
        <option value="amount">Reach an amount</option></select></label>
      <label data-k="amount">Target amount (${base})<input type="number" name="amount" step="any" min="0"></label>
      <label data-k="income">Monthly income wanted (${base})<input type="number" name="income" step="any" min="0"></label>
      <label data-k="swr">Safe withdrawal rate (%)<input type="number" name="swr" step="0.1" min="0.5"></label>
      <label>Starting value (${base})<input type="number" name="start" step="any" min="0"><span class="muted small">your portfolio today: ${money(r.totals.value, base)}</span></label>
      <label>Monthly contribution (${base})<input type="number" name="monthly" step="any" min="0"></label>
      <label>Expected return (% a year)<input type="number" name="ret" step="0.1"><span class="muted small">${cagr !== null ? `your annualised TWR so far: ${pct(cagr)}` : 'long-run stock markets ≈ 6–8%'}</span></label>
      <label>Inflation (% a year)<input type="number" name="infl" step="0.1"></label>
      <label>Contributions grow (% a year)<input type="number" name="growth" step="0.1"></label>
      <label>Horizon (years)<input type="number" name="years" min="1" max="60"></label>
    </form>
  </div>
  <div class="kpis" id="gk"></div>
  <div class="card"><div class="card-head"><h3>Projection</h3></div><div class="chart-box"><canvas id="goalChart"></canvas></div></div>`;
  const f = $('#gf');
  for (const [k, v] of Object.entries(g)) if (f[k]) f[k].value = v;
  const draw = () => {
    const v = Object.fromEntries([...new FormData(f)].map(([k, x]) => [k, k === 'kind' ? x : +x]));
    store.setSettingsQuiet({ goal: v });
    $$('[data-k]', f).forEach((l) => { l.hidden = !({ fire: ['income', 'swr'], dividends: ['income'], amount: ['amount'] }[v.kind].includes(l.dataset.k)); });
    const yieldUsed = divYield || 0.03;
    const goal = v.kind === 'amount' ? v.amount : v.kind === 'fire' ? fireNumber(v.income, v.swr / 100) : (v.income * 12) / yieldUsed;
    const opts = { start: v.start, monthly: v.monthly, annualReturn: v.ret / 100, inflation: v.infl / 100, contributionGrowth: v.growth / 100 };
    const months = monthsToGoal({ ...opts, goal });
    const proj = project({ ...opts, years: v.years });
    const need = monthlyNeeded({ ...opts, goal, years: v.years });
    const eta = months === null ? null : new Date(Date.now() + months * 30.44 * 864e5);
    $('#gk').innerHTML = [
      kpi('Target', money(goal, base, { digits: 0 }), v.kind === 'fire' ? `${money(v.income, base, { digits: 0 })}/month at ${num(v.swr, 1)}%` : v.kind === 'dividends' ? `at ${pct(yieldUsed, { sign: false })} dividend yield${divYield ? ' (yours)' : ''}` : ''),
      kpi('Progress', pct(Math.min(1, v.start / goal), { sign: false, digits: 1 }), `${money(v.start, base, { digits: 0 })} of ${money(goal, base, { compact: true })}`),
      kpi('Reached in', months === null ? 'not within 80 y' : months === 0 ? 'already there 🎉' : `${Math.floor(months / 12)} y ${months % 12} m`, eta && months ? eta.toLocaleDateString(locale(), { year: 'numeric', month: 'short' }) : ''),
      kpi(`Needed monthly for ${v.years} y`, money(need, base, { digits: 0 }), need > v.monthly ? `${money(need - v.monthly, base, { digits: 0 })} more than now` : 'you are on track'),
      kpi(`Value in ${v.years} y`, money(proj[proj.length - 1].real, base, { compact: true }), `nominal ${money(proj[proj.length - 1].value, base, { compact: true })}`),
    ].join('');
    const y0 = new Date().getFullYear();
    chart($('#goalChart'), {
      type: 'line',
      data: { labels: proj.map((p) => String(y0 + p.year)), datasets: [
        { label: tr('Projected value (today’s money)'), data: proj.map((p) => p.real), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent-soft'), fill: true, pointRadius: 0, borderWidth: 2 },
        { label: tr('Contributed'), data: proj.map((p) => p.contributed), borderColor: cssVar('--muted'), borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 },
        { label: tr('Goal'), data: proj.map(() => goal), borderColor: cssVar('--pos'), pointRadius: 0, borderWidth: 1.5 },
      ] },
      options: { ...lineOpts(base), scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { ticks: { callback: (x) => money(x, base, { compact: true }) } } } },
    });
  };
  f.addEventListener('input', draw);
  draw();
}
