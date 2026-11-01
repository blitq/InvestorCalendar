// Broker statement importers. Pure functions: rows (array of arrays, incl. any preamble) in,
// { transactions, errors, notes, accountCurrency } out. Tickers come back as best-effort Yahoo symbols;
// anything we cannot map (e.g. bare ISINs) is returned as "ISIN:XXXX" for the mapping step.
import { parseNumber, parseDate } from './importers.js';

const low = (s) => String(s ?? '').trim().toLowerCase();
const cell = (r, i) => (i >= 0 && i < r.length ? r[i] : '');
const isCcy = (s) => /^[A-Z]{3}$/.test(String(s ?? '').trim());
const r6 = (x) => Math.round(x * 1e6) / 1e6;

function findHeader(rows, groups, limit = 40) {
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const cells = rows[i].map(low);
    if (groups.every((alts) => cells.some((c) => alts.includes(c)))) return i;
  }
  return -1;
}
function col(header, alts) {
  const h = header.map(low);
  for (const a of alts) { const i = h.indexOf(a); if (i >= 0) return i; }
  for (const a of alts) { const i = h.findIndex((x) => x.startsWith(a)); if (i >= 0) return i; }
  return -1;
}

// ------------------------------------------------------------------ symbols

const XTB_MARKETS = {
  US: ['', 'USD'], PL: ['.WA', 'PLN'], UK: ['.L', 'GBP'], DE: ['.DE', 'EUR'], FR: ['.PA', 'EUR'], NL: ['.AS', 'EUR'],
  ES: ['.MC', 'EUR'], IT: ['.MI', 'EUR'], PT: ['.LS', 'EUR'], BE: ['.BR', 'EUR'], FI: ['.HE', 'EUR'], AT: ['.VI', 'EUR'],
  IE: ['.IR', 'EUR'], DK: ['.CO', 'DKK'], SE: ['.ST', 'SEK'], NO: ['.OL', 'NOK'], CH: ['.SW', 'CHF'], CZ: ['.PR', 'CZK'],
};

/** XTB symbol (AAPL.US, PKN.PL, BRK.B.US, VWCE.DE_9) → { ticker, currency } */
export function xtbSymbol(sym) {
  const s = String(sym || '').trim().toUpperCase().replace(/_\d+$/, '');
  const m = s.match(/^(.+)\.([A-Z]{2})$/);
  if (!m || !XTB_MARKETS[m[2]]) return { ticker: s, currency: null };
  const [suffix, currency] = XTB_MARKETS[m[2]];
  const root = m[2] === 'US' ? m[1].replace(/\./g, '-') : m[1];
  return { ticker: root + suffix, currency };
}

const IB_EXCH = {
  NASDAQ: '', NYSE: '', ARCA: '', AMEX: '', BATS: '', ISLAND: '', PINK: '', NYSEARCA: '',
  IBIS: '.DE', IBIS2: '.DE', XETRA: '.DE', FWB: '.F', FWB2: '.F', SBF: '.PA', AEB: '.AS', ENEXT: '.AS', LSE: '.L', LSEETF: '.L',
  EBS: '.SW', BVME: '.MI', 'BVME.ETF': '.MI', BM: '.MC', SFB: '.ST', KFB: '.CO', OSE: '.OL', HEX: '.HE', WSE: '.WA',
  TSE: '.TO', ASX: '.AX', SEHK: '.HK', VSE: '.VI', EBR: '.BR',
};
export function ibSymbol(sym, exch) {
  const suffix = IB_EXCH[String(exch || '').toUpperCase()] ?? '';
  const root = String(sym).trim().toUpperCase().replace(/\s+/g, '-');
  return (suffix === '' ? root.replace(/\./g, '-') : root) + suffix;
}

// ------------------------------------------------------------------ detection

export function detectBroker(rows) {
  const head = rows.slice(0, 40).map((r) => r.map(low));
  const has = (r, ...xs) => xs.every((x) => (Array.isArray(x) ? x.some((y) => r.includes(y)) : r.includes(x)));
  if (rows.slice(0, 200).some((r) => low(r[1]) === 'header' && ['trades', 'dividends', 'statement'].includes(low(r[0])))) return 'ibkr';
  for (const r of head) {
    if (has(r, ['type', 'typ'], ['time', 'czas'], ['comment', 'komentarz'], 'symbol', ['amount', 'kwota'])) return 'xtb';
    if (has(r, 'isin', ['order id', 'identyfikator zlecenia', 'order-id', 'id zlecenia'], ['quantity', 'liczba', 'aantal', 'ilość'])) return 'degiro-transactions';
    if (has(r, 'isin', ['description', 'opis', 'omschrijving'], ['change', 'mutatie', 'zmiana', 'mutation'])) return 'degiro-account';
    if (has(r, 'ticker', 'type', 'price per share', 'total amount')) return 'revolut';
  }
  return null;
}

export const BROKER_NAMES = {
  xtb: 'XTB (cash operations)', 'degiro-transactions': 'Degiro (Transactions.csv)', 'degiro-account': 'Degiro (Account.csv: dividends, deposits)',
  ibkr: 'Interactive Brokers (Activity statement)', revolut: 'Revolut (trading statement)',
};

// ------------------------------------------------------------------ helpers

/** Attach withholding tax rows to their dividend (same ticker, within a few days). */
function pairTaxes(divs, taxes, out, notes) {
  for (const tx of taxes) {
    const d = divs.find((x) => x.ticker === tx.ticker && !x._taxed && Math.abs(Date.parse(x.date) - Date.parse(tx.date)) <= 5 * 864e5);
    if (d) {
      d._taxed = true;
      if (d.settleCurrency && tx.currency === d.settleCurrency) {
        // tax booked in account currency: convert to the dividend currency with the same effective rate
        const rate = d.amount / d._settleGross;
        d.tax = r6(tx.amount * rate);
        d.settleAmount = r6(d._settleGross - tx.amount);
      } else d.tax = r6((d.tax || 0) + tx.amount);
    } else {
      out.push({ date: tx.date, type: 'TAX', amount: tx.amount, currency: tx.currency, ticker: tx.ticker, note: 'withholding tax' });
      notes.add('Some withholding tax rows had no matching dividend and were imported as TAX.');
    }
  }
  for (const d of divs) { delete d._taxed; delete d._settleGross; }
}

function finish(list, portfolioId) {
  return list.sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({ portfolioId, ...t }));
}

// ------------------------------------------------------------------ XTB

/** XTB "Cash operations" sheet (xlsx or csv, EN or PL). */
export function parseXTB(rows, { portfolioId, accountCurrency } = {}) {
  const errors = [], notes = new Set();
  const h = findHeader(rows, [['type', 'typ'], ['time', 'czas'], ['amount', 'kwota']]);
  if (h < 0) return { transactions: [], errors: [{ row: 0, message: 'XTB header row not found' }], notes: [] };
  // account currency is printed in the preamble ("Currency" | "PLN")
  let acct = accountCurrency;
  for (let i = 0; i < h && !acct; i++) {
    const r = rows[i];
    const k = r.findIndex((c) => ['currency', 'waluta'].includes(low(c)));
    if (k >= 0) acct = [cell(r, k + 1), cell(rows[i + 1] || [], k)].find(isCcy);
  }
  acct = acct || 'PLN';
  const H = rows[h];
  const ci = { type: col(H, ['type', 'typ']), time: col(H, ['time', 'czas']), comment: col(H, ['comment', 'komentarz']),
    symbol: col(H, ['symbol', 'instrument']), amount: col(H, ['amount', 'kwota']) };

  const events = [];
  rows.slice(h + 1).forEach((r, i) => {
    const type = low(cell(r, ci.type));
    if (!type || type === 'total' || type === 'suma') return;
    const date = parseDate(cell(r, ci.time));
    const amount = parseNumber(cell(r, ci.amount));
    if (!date || amount === null) { errors.push({ row: h + i + 2, message: `unreadable row (${cell(r, ci.type)})` }); return; }
    events.push({ row: h + i + 2, type, date, time: String(cell(r, ci.time)), amount, comment: String(cell(r, ci.comment) || ''), symbol: String(cell(r, ci.symbol) || '') });
  });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const out = [], divs = [], taxes = [], pos = {};
  for (const e of events) {
    const sym = e.symbol ? xtbSymbol(e.symbol) : { ticker: '', currency: null };
    const amt = Math.abs(e.amount);
    const t = e.type;
    const isTax = /withholding|tax|podatek/.test(t);
    if (/purchase|zakup|kupno/.test(t) || /sale|sprzeda/.test(t)) {
      const m = e.comment.match(/(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+([\d.,]+)(?:\s*\/\s*[\d.,]+)?\s*@\s*([\d.,]+)/i);
      if (!m) { errors.push({ row: e.row, message: `cannot read quantity/price from "${e.comment}"` }); continue; }
      const qty = parseNumber(m[1]), price = parseNumber(m[2]);
      const type = /purchase|zakup|kupno/.test(t) ? 'BUY' : 'SELL';
      const ccy = sym.currency || acct;
      const tx = { date: e.date, type, ticker: sym.ticker, quantity: qty, price, currency: ccy, fee: 0 };
      if (ccy === acct) {
        const fee = type === 'BUY' ? amt - qty * price : qty * price - amt;
        tx.fee = fee > 0.005 ? r6(fee) : 0;
      } else Object.assign(tx, { settleAmount: amt, settleCurrency: acct });
      pos[sym.ticker] = (pos[sym.ticker] || 0) + (type === 'BUY' ? qty : -qty);
      out.push(tx);
    } else if (/divid/.test(t) && !isTax) {
      const m = e.comment.match(/([A-Z]{3})\s+([\d.,]+)\s*\/\s*(?:SHR|AKC)/i);
      const held = pos[sym.ticker] || 0;
      const tx = { date: e.date, type: 'DIVIDEND', ticker: sym.ticker, tax: 0 };
      if (m && m[1].toUpperCase() !== acct && held > 0) {
        Object.assign(tx, { currency: m[1].toUpperCase(), amount: r6(held * parseNumber(m[2])), settleAmount: amt, settleCurrency: acct, _settleGross: amt });
      } else Object.assign(tx, { currency: acct, amount: amt });
      divs.push(tx); out.push(tx);
    } else if (isTax && sym.ticker) {
      taxes.push({ date: e.date, ticker: sym.ticker, amount: amt, currency: acct });
    } else if (/deposit|wpłat|wplat/.test(t) || (/transfer/.test(t) && e.amount > 0)) {
      out.push({ date: e.date, type: 'DEPOSIT', amount: amt, currency: acct });
    } else if (/withdraw|wypłat|wyplat/.test(t) || (/transfer/.test(t) && e.amount < 0)) {
      out.push({ date: e.date, type: 'WITHDRAWAL', amount: amt, currency: acct });
    } else if (/interest|odsetk/.test(t)) {
      out.push({ date: e.date, type: isTax ? 'TAX' : (e.amount >= 0 ? 'INTEREST' : 'FEE'), amount: amt, currency: acct, note: e.type });
    } else if (isTax) {
      out.push({ date: e.date, type: 'TAX', amount: amt, currency: acct, note: e.type });
    } else if (/fee|commission|prowizj|opłat|oplat|stamp|sec /.test(t)) {
      out.push({ date: e.date, type: e.amount < 0 ? 'FEE' : 'INTEREST', amount: amt, currency: acct, note: e.type, ...(sym.ticker ? { ticker: sym.ticker } : {}) });
    } else if (/close trade|profit|swap|rollover|adjustment/.test(t)) {
      notes.add('CFD rows (close trade, swap, rollover) were skipped — only stocks and ETFs are tracked.');
    } else {
      errors.push({ row: e.row, message: `unknown operation "${e.type}"` });
    }
  }
  pairTaxes(divs, taxes, out, notes);
  return { transactions: finish(out, portfolioId), errors, notes: [...notes], accountCurrency: acct };
}

// ------------------------------------------------------------------ Degiro

function amountAndCcy(r, i) {
  // Degiro puts the currency in the column next to the amount (left or right depending on the file)
  const a = cell(r, i), b = cell(r, i + 1);
  if (isCcy(a) && !isCcy(b)) return [parseNumber(b), String(a).trim()];
  if (isCcy(b)) return [parseNumber(a), String(b).trim()];
  return [parseNumber(a), null];
}

export function parseDegiroTransactions(rows, { portfolioId, isinMap = {} } = {}) {
  const errors = [], notes = new Set();
  const h = findHeader(rows, [['isin'], ['quantity', 'liczba', 'aantal', 'ilość', 'anzahl']]);
  const H = rows[h];
  const ci = {
    date: col(H, ['date', 'data', 'datum']), isin: col(H, ['isin']), product: col(H, ['product', 'produkt']),
    qty: col(H, ['quantity', 'liczba', 'aantal', 'ilość', 'anzahl']), price: col(H, ['price', 'kurs', 'koers']),
    value: col(H, ['value', 'wartość', 'waarde', 'wert']),
    fee: col(H, ['transaction and/or third party fees', 'transaction costs', 'transactiekosten', 'opłata transakcyjna', 'koszty transakcyjne', 'transaktionskosten']),
    total: col(H, ['total', 'razem', 'totaal', 'gesamt']),
  };
  const out = [];
  rows.slice(h + 1).forEach((r, i) => {
    if (!r.some((c) => String(c).trim())) return;
    const date = parseDate(cell(r, ci.date));
    const qty = parseNumber(cell(r, ci.qty));
    const [price, pccy] = amountAndCcy(r, ci.price);
    if (!date || !qty || price === null) { errors.push({ row: h + i + 2, message: 'missing date, quantity or price' }); return; }
    const isin = String(cell(r, ci.isin)).trim().toUpperCase();
    const ticker = isinMap[isin] || (isin ? `ISIN:${isin}` : String(cell(r, ci.product)).trim());
    const [fee, fccy] = ci.fee >= 0 ? amountAndCcy(r, ci.fee) : [0, null];
    const [total, tccy] = ci.total >= 0 ? amountAndCcy(r, ci.total) : [null, null];
    const type = qty < 0 ? 'SELL' : 'BUY';
    const tx = { date, type, ticker, quantity: Math.abs(qty), price: Math.abs(price), currency: pccy || tccy || 'EUR', fee: 0, note: String(cell(r, ci.product) || '') };
    if (tccy && tccy !== tx.currency && total !== null) Object.assign(tx, { settleAmount: Math.abs(total), settleCurrency: tccy });
    else if (fee && (!fccy || fccy === tx.currency)) tx.fee = Math.abs(fee);
    out.push(tx);
  });
  return { transactions: finish(out, portfolioId), errors, notes: [...notes] };
}

export function parseDegiroAccount(rows, { portfolioId, isinMap = {} } = {}) {
  const errors = [], notes = new Set();
  const h = findHeader(rows, [['isin'], ['description', 'opis', 'omschrijving', 'beschreibung']]);
  const H = rows[h];
  const ci = { date: col(H, ['date', 'data', 'datum']), isin: col(H, ['isin']), product: col(H, ['product', 'produkt']),
    desc: col(H, ['description', 'opis', 'omschrijving', 'beschreibung']), change: col(H, ['change', 'mutatie', 'zmiana', 'mutation', 'änderung']) };
  const out = [], divs = [], taxes = [];
  rows.slice(h + 1).forEach((r, i) => {
    const desc = low(cell(r, ci.desc));
    if (!desc) return;
    const date = parseDate(cell(r, ci.date));
    const [amount, ccy] = amountAndCcy(r, ci.change);
    if (!date || amount === null || !amount) return;
    const isin = String(cell(r, ci.isin)).trim().toUpperCase();
    const ticker = isin ? (isinMap[isin] || `ISIN:${isin}`) : '';
    const amt = Math.abs(amount), currency = ccy || 'EUR';
    if (/dividend|dywidend/.test(desc) && /tax|belasting|podatek|steuer/.test(desc)) taxes.push({ date, ticker, amount: amt, currency });
    else if (/dividend|dywidend/.test(desc)) { const tx = { date, type: 'DIVIDEND', ticker, amount: amt, tax: 0, currency }; divs.push(tx); out.push(tx); }
    else if (/fx|valuta|wymiana|currency|koop|verkoop|buy|sell|kupno|sprzeda|kauf|verkauf|geldmarkt|money market|reservation|rezerwacja/.test(desc)) { /* trades & FX come from Transactions.csv */ }
    else if (/withdraw|terugstorting|wypłat|wyplat|auszahlung/.test(desc)) out.push({ date, type: 'WITHDRAWAL', amount: amt, currency });
    else if (/deposit|storting|wpłat|wplat|einzahlung|ideal|sofort/.test(desc)) out.push({ date, type: 'DEPOSIT', amount: amt, currency });
    else if (/interest|rente|odsetk|zins/.test(desc)) out.push({ date, type: amount >= 0 ? 'INTEREST' : 'FEE', amount: amt, currency, note: cell(r, ci.desc) });
    else if (/fee|kosten|opłat|oplat|gebühr|connection/.test(desc)) out.push({ date, type: 'FEE', amount: amt, currency, note: cell(r, ci.desc) });
    else errors.push({ row: h + i + 2, message: `skipped "${cell(r, ci.desc)}"` });
  });
  pairTaxes(divs, taxes, out, notes);
  notes.add('Buys and sells are imported from Degiro’s Transactions.csv; currency conversions are not imported.');
  return { transactions: finish(out, portfolioId), errors, notes: [...notes] };
}

// ------------------------------------------------------------------ Interactive Brokers

export function parseIBKR(rows, { portfolioId } = {}) {
  const errors = [], notes = new Set();
  const headers = {};
  const data = {};
  for (const r of rows) {
    const sec = String(r[0] || '').trim(), kind = low(r[1]);
    if (kind === 'header') headers[sec] = r.slice(2);
    else if (kind === 'data' && headers[sec]) (data[sec] ||= []).push(Object.fromEntries(headers[sec].map((k, i) => [k, r[i + 2]])));
  }
  const exch = {};
  for (const x of data['Financial Instrument Information'] || []) exch[String(x.Symbol).trim()] = x['Listing Exch'] || x.Exchange;
  const out = [], divs = [], taxes = [];
  for (const x of data.Trades || []) {
    if (x.DataDiscriminator && x.DataDiscriminator !== 'Order') continue;
    if (!/stock|etf/i.test(x['Asset Category'] || 'Stocks')) { notes.add('Only stock/ETF trades were imported (options, futures and forex skipped).'); continue; }
    const qty = parseNumber(x.Quantity), price = parseNumber(x['T. Price'] ?? x.Price);
    const date = parseDate(String(x['Date/Time'] || x.Date || '').split(',')[0]);
    if (!date || !qty || price === null) { errors.push({ row: 0, message: `trade ${x.Symbol}: missing data` }); continue; }
    const ticker = ibSymbol(x.Symbol, exch[String(x.Symbol).trim()]);
    out.push({ date, type: qty < 0 ? 'SELL' : 'BUY', ticker, quantity: Math.abs(qty), price, fee: Math.abs(parseNumber(x['Comm/Fee'] ?? x.Commission) || 0), currency: x.Currency });
  }
  const tickerOf = (desc) => {
    const sym = String(desc || '').split(/[\s(]/)[0].trim();
    return sym ? ibSymbol(sym, exch[sym]) : '';
  };
  for (const x of data.Dividends || []) {
    if (/total/i.test(x.Currency) || !x.Date) continue;
    const tx = { date: parseDate(x.Date), type: 'DIVIDEND', ticker: tickerOf(x.Description), amount: Math.abs(parseNumber(x.Amount)), tax: 0, currency: x.Currency };
    divs.push(tx); out.push(tx);
  }
  for (const x of data['Withholding Tax'] || []) {
    if (/total/i.test(x.Currency) || !x.Date) continue;
    taxes.push({ date: parseDate(x.Date), ticker: tickerOf(x.Description), amount: -parseNumber(x.Amount), currency: x.Currency });
  }
  // tax refunds show up as positive withholding rows: net them against the same dividend
  pairTaxes(divs, taxes.filter((t) => t.amount > 0), out, notes);
  for (const x of data['Deposits & Withdrawals'] || []) {
    if (/total/i.test(x.Currency)) continue;
    const a = parseNumber(x.Amount), date = parseDate(x['Settle Date'] || x.Date);
    if (a && date) out.push({ date, type: a > 0 ? 'DEPOSIT' : 'WITHDRAWAL', amount: Math.abs(a), currency: x.Currency });
  }
  for (const x of data.Interest || []) {
    if (/total/i.test(x.Currency)) continue;
    const a = parseNumber(x.Amount), date = parseDate(x.Date);
    if (a && date) out.push({ date, type: a > 0 ? 'INTEREST' : 'FEE', amount: Math.abs(a), currency: x.Currency, note: x.Description });
  }
  for (const x of data.Fees || []) {
    if (/total/i.test(x.Currency) || !x.Date) continue;
    const a = parseNumber(x.Amount), date = parseDate(x.Date);
    if (a && date) out.push({ date, type: a < 0 ? 'FEE' : 'INTEREST', amount: Math.abs(a), currency: x.Currency, note: x.Description });
  }
  return { transactions: finish(out, portfolioId), errors, notes: [...notes] };
}

// ------------------------------------------------------------------ Revolut

export function parseRevolut(rows, { portfolioId } = {}) {
  const errors = [], notes = new Set();
  const h = findHeader(rows, [['ticker'], ['type'], ['total amount']]);
  const H = rows[h];
  const ci = { date: col(H, ['date']), ticker: col(H, ['ticker']), type: col(H, ['type']), qty: col(H, ['quantity']),
    price: col(H, ['price per share']), total: col(H, ['total amount']), ccy: col(H, ['currency']) };
  const out = [];
  rows.slice(h + 1).forEach((r, i) => {
    const t = low(cell(r, ci.type));
    if (!t) return;
    const date = parseDate(cell(r, ci.date));
    const ccy = String(cell(r, ci.ccy) || '').trim().toUpperCase() || 'USD';
    const total = Math.abs(parseNumber(cell(r, ci.total)) || 0);
    const ticker = String(cell(r, ci.ticker) || '').trim().toUpperCase();
    if (!date) { errors.push({ row: h + i + 2, message: 'bad date' }); return; }
    if (/^(buy|sell)/.test(t)) {
      const qty = Math.abs(parseNumber(cell(r, ci.qty)) || 0), price = Math.abs(parseNumber(cell(r, ci.price)) || 0);
      if (!qty || !price) { errors.push({ row: h + i + 2, message: 'missing quantity/price' }); return; }
      const type = t.startsWith('buy') ? 'BUY' : 'SELL';
      const fee = type === 'BUY' ? total - qty * price : qty * price - total;
      out.push({ date, type, ticker, quantity: qty, price, fee: fee > 0.005 ? r6(fee) : 0, currency: ccy });
    } else if (/dividend/.test(t)) out.push({ date, type: 'DIVIDEND', ticker, amount: total, tax: 0, currency: ccy, note: 'net of withholding tax' });
    else if (/top-up|top up|deposit/.test(t)) out.push({ date, type: 'DEPOSIT', amount: total, currency: ccy });
    else if (/withdraw/.test(t)) out.push({ date, type: 'WITHDRAWAL', amount: total, currency: ccy });
    else if (/fee/.test(t)) out.push({ date, type: 'FEE', amount: total, currency: ccy, note: cell(r, ci.type) });
    else if (/split/.test(t)) notes.add('Stock split rows skipped — splits are applied automatically from market data.');
    else errors.push({ row: h + i + 2, message: `unknown type "${cell(r, ci.type)}"` });
  });
  if (out.some((t) => t.type === 'DIVIDEND')) notes.add('Revolut reports dividends net of withholding tax; gross amounts are not available.');
  return { transactions: finish(out, portfolioId), errors, notes: [...notes] };
}

export const PARSERS = {
  xtb: parseXTB, 'degiro-transactions': parseDegiroTransactions, 'degiro-account': parseDegiroAccount, ibkr: parseIBKR, revolut: parseRevolut,
};
