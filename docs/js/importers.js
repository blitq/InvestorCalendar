// CSV import/export with automatic column detection (English + Polish headers).
// Pure functions — tested in Node.

export const FIELDS = ['date', 'type', 'ticker', 'quantity', 'price', 'fee', 'amount', 'tax', 'currency', 'settleAmount', 'settleCurrency', 'toAmount', 'toCurrency', 'note'];

const SYNONYMS = {
  date: ['date', 'data', 'trade date', 'data transakcji', 'czas transakcji', 'data operacji', 'data zlecenia', 'data realizacji', 'czas', 'time', 'open time', 'close time', 'execution date', 'settlement date'],
  type: ['type', 'typ', 'action', 'operation', 'operacja', 'transaction type', 'rodzaj', 'side', 'kierunek', 'k/s', 'strona', 'rodzaj transakcji', 'typ transakcji', 'kupno/sprzedaż'],
  ticker: ['ticker', 'symbol', 'instrument', 'walor', 'papier', 'product', 'produkt', 'security', 'stock', 'spółka', 'spolka', 'nazwa waloru', 'papier wartościowy', 'nazwa instrumentu'],
  quantity: ['quantity', 'qty', 'shares', 'ilość', 'ilosc', 'liczba', 'volume', 'wolumen', 'units', 'liczba akcji', 'liczba sztuk', 'ilość sztuk', 'liczba papierów'],
  price: ['price', 'cena', 'kurs', 'unit price', 'share price', 'price per share', 'open price', 'cena jednostkowa', 'kurs transakcji', 'cena wykonania', 'kurs wykonania'],
  fee: ['fee', 'fees', 'commission', 'prowizja', 'opłata', 'oplata', 'costs', 'transaction costs'],
  amount: ['amount', 'kwota', 'value', 'wartość', 'wartosc', 'total', 'net amount', 'gross amount', 'gross'],
  tax: ['tax', 'podatek', 'withholding tax', 'withholding', 'tax withheld', 'podatek u źródła'],
  currency: ['currency', 'waluta', 'ccy', 'curr'],
  note: ['note', 'notes', 'comment', 'komentarz', 'uwagi', 'description', 'opis'],
  settleAmount: ['settleamount', 'settle amount', 'settlement amount', 'kwota rozliczenia', 'wartość rozliczenia', 'wartosc rozliczenia', 'total in account currency', 'account amount'],
  toAmount: ['toamount', 'to amount', 'amount received', 'kwota docelowa', 'kwota po wymianie'],
  toCurrency: ['tocurrency', 'to currency', 'target currency', 'waluta docelowa'],
  settleCurrency: ['settlecurrency', 'settle currency', 'settlement currency', 'waluta rozliczenia', 'account currency', 'waluta rachunku'],
};

const TYPE_WORDS = [
  ['BUY', ['buy', 'b', 'kupno', 'k', 'zakup', 'purchase', 'bought', 'stock purchase', 'open buy', 'market buy', 'limit buy']],
  ['SELL', ['sell', 's', 'sprzedaż', 'sprzedaz', 'sold', 'stock sale', 'close buy', 'market sell', 'limit sell']],
  ['DIVIDEND', ['dividend', 'div', 'dywidenda', 'dividends', 'cash dividend']],
  ['DEPOSIT', ['deposit', 'wpłata', 'wplata', 'transfer in', 'cash in', 'wpływ', 'wplyw']],
  ['WITHDRAWAL', ['withdrawal', 'withdraw', 'wypłata', 'wyplata', 'transfer out', 'cash out']],
  ['FEE', ['fee', 'prowizja', 'opłata', 'oplata', 'commission', 'custody fee']],
  ['INTEREST', ['interest', 'odsetki', 'free funds interest']],
  ['TAX', ['tax', 'podatek', 'withholding tax']],
  ['CONVERSION', ['conversion', 'exchange', 'fx', 'currency exchange', 'wymiana', 'przewalutowanie', 'wymiana walut']],
];

export function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = [',', ';', '\t', '|'].map((d) => [d, splitLine(line, d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

function splitLine(line, delim) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse CSV text → { headers, rows } (rows are arrays). Handles quotes and BOM. */
export function parseCSV(text, delim) {
  text = text.replace(/^﻿/, '');
  const d = delim || detectDelimiter(text);
  // join physical lines that are inside quotes
  const lines = [];
  let buf = '';
  for (const line of text.split(/\r?\n/)) {
    buf = buf ? buf + '\n' + line : line;
    if ((buf.match(/"/g) || []).length % 2 === 0) { lines.push(buf); buf = ''; }
  }
  if (buf) lines.push(buf);
  const rows = lines.filter((l) => l.trim()).map((l) => splitLine(l, d));
  return { headers: rows[0] || [], rows: rows.slice(1), delimiter: d };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[_\-.()]/g, ' ').replace(/\s+/g, ' ').trim();

/** Guess which column holds which field: { field: columnIndex } */
export function detectColumns(headers) {
  const mapping = {};
  const used = new Set();
  const h = headers.map(norm);
  for (const field of FIELDS) {
    // exact synonym first, then "header starts with synonym"
    let idx = h.findIndex((x, i) => !used.has(i) && SYNONYMS[field].includes(x));
    if (idx < 0) idx = h.findIndex((x, i) => !used.has(i) && SYNONYMS[field].some((s) => s.length > 2 && x.startsWith(s)));
    if (idx >= 0) { mapping[field] = idx; used.add(idx); }
  }
  return mapping;
}

/** "1 234,56" / "1,234.56" / "(12.5)" / "12.5 USD" → number */
export function parseNumber(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/[\s ']/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^0-9,.\-+eE]/g, '');
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "1,234" with exactly 3 decimals and one comma is ambiguous; treat comma as decimal (EU style)
    s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

/** Many date formats → 'YYYY-MM-DD' (day-first for ambiguous dd/mm/yyyy). */
export function parseDate(v, { monthFirst = false } = {}) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    let [a, b] = [+m[1], +m[2]];
    if (monthFirst || b > 12) [a, b] = [b, a];
    return iso(m[3], b, a);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(m[1], m[2], m[3]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
function iso(y, mo, d) {
  mo = +mo; d = +d;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseType(v) {
  const s = norm(v);
  if (!s) return null;
  for (const [type, words] of TYPE_WORDS) if (words.includes(s)) return type;
  for (const [type, words] of TYPE_WORDS) if (words.some((w) => w.length > 2 && s.includes(w))) return type;
  return null;
}

/**
 * Convert parsed rows into transactions.
 * defaults: { portfolioId, currency, type, monthFirst, tickerSuffix }
 * Returns { transactions, errors: [{row, message}] }
 */
export function rowsToTransactions(rows, mapping, defaults = {}) {
  const get = (r, f) => (mapping[f] === undefined || mapping[f] === '' || mapping[f] === null ? '' : r[mapping[f]]);
  const transactions = [], errors = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const date = parseDate(get(r, 'date'), defaults);
    if (!date) { errors.push({ row: rowNo, message: `bad date "${get(r, 'date')}"` }); return; }
    let qty = parseNumber(get(r, 'quantity'));
    let type = parseType(get(r, 'type')) || defaults.type || null;
    if (!type && qty !== null) type = qty < 0 ? 'SELL' : 'BUY';
    if (!type) { errors.push({ row: rowNo, message: `unknown type "${get(r, 'type')}"` }); return; }
    let ticker = String(get(r, 'ticker') || '').trim().toUpperCase();
    if (ticker && gpwTicker(ticker)) ticker = gpwTicker(ticker); // mBank/Bossa use GPW short names (PKNORLEN…)
    else if (ticker && defaults.tickerSuffix && !ticker.includes('.')) ticker += defaults.tickerSuffix;
    const currency = (String(get(r, 'currency') || '').trim().toUpperCase() || defaults.currency || '').slice(0, 3);
    const tx = { portfolioId: defaults.portfolioId, date, type, currency };
    const sAmt = parseNumber(get(r, 'settleAmount'));
    const sCcy = String(get(r, 'settleCurrency') || '').trim().toUpperCase().slice(0, 3);
    const settle = sAmt && sCcy && sCcy !== currency ? { settleAmount: Math.abs(sAmt), settleCurrency: sCcy } : null;
    const note = get(r, 'note');
    if (note) tx.note = String(note);
    if (type === 'BUY' || type === 'SELL') {
      const price = parseNumber(get(r, 'price'));
      qty = qty === null ? null : Math.abs(qty);
      if (!ticker || !qty || price === null) { errors.push({ row: rowNo, message: 'trade needs ticker, quantity and price' }); return; }
      Object.assign(tx, { ticker, quantity: qty, price: Math.abs(price), fee: Math.abs(parseNumber(get(r, 'fee')) || 0) }, settle);
    } else {
      const amount = parseNumber(get(r, 'amount'));
      if (amount === null) { errors.push({ row: rowNo, message: 'amount missing' }); return; }
      tx.amount = Math.abs(amount);
      if (ticker) tx.ticker = ticker;
      if (type === 'DIVIDEND') { tx.tax = Math.abs(parseNumber(get(r, 'tax')) || 0); Object.assign(tx, settle); }
      if (type === 'CONVERSION') {
        tx.toAmount = Math.abs(parseNumber(get(r, 'toAmount')) || 0);
        tx.toCurrency = String(get(r, 'toCurrency') || '').trim().toUpperCase().slice(0, 3);
        if (!tx.toAmount || !tx.toCurrency) { errors.push({ row: rowNo, message: 'conversion needs toAmount and toCurrency' }); return; }
      }
    }
    transactions.push(tx);
  });
  return { transactions, errors };
}

/** Transactions → CSV in this app's native format (re-importable). */
export function toCSV(transactions, portfolios = []) {
  const pname = Object.fromEntries(portfolios.map((p) => [p.id, p.name]));
  const cols = ['portfolio', ...FIELDS];
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(cols.map((c) => esc(c === 'portfolio' ? pname[t.portfolioId] || t.portfolioId : t[c])).join(','));
  }
  return lines.join('\n');
}

/** Do two transactions look like the same real-world event? Used to skip re-imports. */
export function txFingerprint(t) {
  return [t.portfolioId, t.date, t.type, t.ticker || '', +(t.quantity || 0).toFixed(6), +(t.price || 0).toFixed(6), +(t.amount || 0).toFixed(4)].join('|');
}

// ------------------------------------------------------------------ encodings & GPW names

/** Decode file bytes: UTF-8 (with or without BOM), else Windows-1250 (common in Polish broker exports). */
export function decodeBytes(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { return new TextDecoder('windows-1250').decode(bytes); }
}

/** GPW short names used by mBank eMakler, Bossa and others → Yahoo tickers. */
export const GPW_NAMES = {
  PKNORLEN: 'PKN.WA', ORLEN: 'PKN.WA', CDPROJEKT: 'CDR.WA', PKOBP: 'PKO.WA', PZU: 'PZU.WA', KGHM: 'KGH.WA', PEKAO: 'PEO.WA',
  ORANGEPL: 'OPL.WA', ALLEGRO: 'ALE.WA', DINOPL: 'DNP.WA', LPP: 'LPP.WA', CYFRPLSAT: 'CPS.WA', JSW: 'JSW.WA', PGE: 'PGE.WA',
  TAURONPE: 'TPE.WA', ENEA: 'ENA.WA', ENERGA: 'ENG.WA', MBANK: 'MBK.WA', SANPL: 'SPL.WA', BUDIMEX: 'BDX.WA', KRUK: 'KRU.WA',
  ALIOR: 'ALR.WA', PEPCO: 'PCO.WA', ZABKA: 'ZAB.WA', AMREST: 'EAT.WA', CCC: 'CCC.WA', KETY: 'KTY.WA', ASSECOPOL: 'ACP.WA',
  XTB: 'XTB.WA', PKPCARGO: 'PKP.WA', GPW: 'GPW.WA', MILLENNIUM: 'MIL.WA', HANDLOWY: 'BHW.WA', INGBSK: 'ING.WA', BNPPPL: 'BNP.WA',
  '11BIT': '11B.WA', TEXT: 'TXT.WA', BENEFIT: 'BFT.WA', AUTOPARTN: 'APR.WA', ASBIS: 'ASB.WA', BOGDANKA: 'LWB.WA', GRUPAAZOTY: 'ATT.WA',
  TSGAMES: 'TEN.WA', PLAYWAY: 'PLW.WA', CIGAMES: 'CIG.WA', DOMDEV: 'DOM.WA', ATAL: '1AT.WA', DEVELIA: 'DVL.WA', NEUCA: 'NEU.WA',
  COMARCH: 'CMR.WA', WIRTUALNA: 'WPL.WA', GRUPRACUJ: 'GPP.WA', SNIEZKA: 'SKA.WA', ORBIS: 'ORB.WA', MABION: 'MAB.WA', SELVITA: 'SLV.WA',
  RYVU: 'RVU.WA', TORPOL: 'TOR.WA', STALPROD: 'STP.WA', MERCATOR: 'MRC.WA', DIGITANET: 'DIG.WA', HUUUGE: 'HUG.WA', VOTUM: 'VOT.WA',
};

/** Yahoo ticker for a GPW short name (incl. Polish ETFs/ETCs like ETFBW20TR), else null. */
export function gpwTicker(name) {
  const k = String(name || '').toUpperCase().replace(/\s+/g, '');
  if (GPW_NAMES[k]) return GPW_NAMES[k];
  if (/^(ETF|BETA)[A-Z0-9]+$/.test(k) && !k.includes('.')) return `${k}.WA`;
  return null;
}
