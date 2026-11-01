// calendar page — split from the former views.js
import { addDays, todayISO, forecastDividends } from '../engine.js';
import { loadEvents } from '../data.js';
import { getLang } from '../i18n.js';
import { $, $$, esc, money, num, fmtDate } from '../ui.js';
import { holdings } from './holdings.js';


export async function calendar(el, ctx) {
  const { events } = await loadEvents();
  const held = new Set(ctx.result.holdings.map((h) => h.ticker));
  const forecast = forecastDividends(ctx.result.holdings, ctx.market, ctx.base).filter((f) => f.date > todayISO())
    .map((f) => ({ ticker: f.ticker, type: 'forecast', date: f.date, title: `${f.ticker} — expected dividend ≈ ${money(f.amountBase, ctx.base)}`, details: { per_share: `${num(f.dps, 4)} ${f.currency}`, estimated_total: money(f.amountBase, ctx.base), basis: 'same payment as a year ago' } }));
  const all = [...events, ...forecast];
  const filters = { earnings: true, dividend: true, split: true, forecast: true, mine: held.size > 0 };
  el.innerHTML = `
  <div class="grid-cal">
    <div class="card">
      <div class="row gap wrap filters">
        ${['earnings', 'dividend', 'split', 'forecast'].map((t) => `<label class="check"><input type="checkbox" data-t="${t}" checked> <span class="tag ${t}">${t === 'forecast' ? 'expected dividend' : t}</span></label>`).join('')}
        <label class="check"><input type="checkbox" data-t="mine" ${filters.mine ? 'checked' : ''}> Only my holdings</label>
      </div>
      <div id="cal"></div>
    </div>
    <div class="card side">
      <div class="card-head"><h3>Next 14 days</h3></div><div id="up14" class="upcoming"></div>
      <div id="evDetail" class="ev-detail"></div>
    </div>
  </div>`;
  let cal;
  const visible = () => all.filter((e) => filters[e.type] && (!filters.mine || held.has(e.ticker)));
  const draw = () => {
    const ev = visible();
    if (cal) cal.destroy();
    if (!window.FullCalendar) { $('#cal').innerHTML = '<p class="muted">Calendar library failed to load.</p>'; return; }
    cal = new window.FullCalendar.Calendar($('#cal'), {
      initialView: 'dayGridMonth', height: 'auto', firstDay: 1, locale: getLang() === 'pl' ? 'pl' : 'en',
      buttonText: getLang() === 'pl' ? { today: 'dziś', month: 'miesiąc', list: 'lista' } : undefined,
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
      events: ev.map((e, i) => ({ id: String(i), title: e.ticker, start: e.date, allDay: true, classNames: ['ev-' + e.type], extendedProps: e })),
      eventClick: (info) => {
        const e = info.event.extendedProps;
        $('#evDetail').innerHTML = `<h4>${esc(e.title)}</h4><div class="muted">${fmtDate(e.date)} · ${esc(e.market || '')}</div>` +
          Object.entries(e.details || {}).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => `<div class="mini-row"><span class="muted">${esc(k.replace(/_/g, ' '))}</span><b>${esc(v)}</b></div>`).join('');
      },
    });
    cal.render();
    const t = todayISO(), u = addDays(t, 14);
    const up = ev.filter((e) => e.date >= t && e.date <= u).sort((a, b) => a.date.localeCompare(b.date));
    $('#up14').innerHTML = up.map((e) => `<div class="mini-row"><span><span class="tag ${e.type}">${e.type === 'forecast' ? 'exp. div' : e.type}</span> <b>${esc(e.ticker)}</b></span><span class="muted">${fmtDate(e.date, { month: 'short', day: 'numeric' })}</span></div>`).join('') || '<div class="muted">Nothing scheduled.</div>';
  };
  $$('[data-t]', el).forEach((cb) => cb.addEventListener('change', () => { filters[cb.dataset.t] = cb.checked; draw(); }));
  draw();
}
