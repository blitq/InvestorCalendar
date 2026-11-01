import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../docs/js/importers.js';
import { detectBroker, xtbSymbol, ibSymbol, parseXTB, parseDegiroTransactions, parseDegiroAccount, parseIBKR, parseRevolut } from '../docs/js/brokers.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const table = (csv) => { const { headers, rows } = parseCSV(csv); return [headers, ...rows]; };

test('symbol mapping', () => {
  assert.deepEqual(xtbSymbol('AAPL.US'), { ticker: 'AAPL', currency: 'USD' });
  assert.deepEqual(xtbSymbol('PKN.PL'), { ticker: 'PKN.WA', currency: 'PLN' });
  assert.deepEqual(xtbSymbol('BRK.B.US'), { ticker: 'BRK-B', currency: 'USD' });
  assert.deepEqual(xtbSymbol('VWCE.DE_9'), { ticker: 'VWCE.DE', currency: 'EUR' });
  assert.equal(ibSymbol('SAP', 'IBIS'), 'SAP.DE');
  assert.equal(ibSymbol('BRK B', 'NYSE'), 'BRK-B');
});

const XTB = [
  ['', 'Account', '12345678', 'Currency', 'PLN'],
  [],
  ['ID', 'Type', 'Time', 'Comment', 'Symbol', 'Amount'],
  ['5', 'Withholding tax', '16.05.2024 10:00:00', 'AAPL.US USD WHT 15%', 'AAPL.US', '-1.51'],
  ['4', 'DIVIDENT', '16.05.2024 10:00:00', 'AAPL.US USD 0.2500/ SHR', 'AAPL.US', '10.05'],
  ['3', 'Stocks/ETF purchase', '05.03.2024 14:33:01', 'OPEN BUY 10 @ 55.20', 'PKO.PL', '-552.00'],
  ['2', 'Stocks/ETF purchase', '04.03.2024 15:40:00', 'OPEN BUY 10/12 @ 170.50', 'AAPL.US', '-6820.00'],
  ['1', 'deposit', '01.03.2024 09:00:00', 'Transfer', '', '10000'],
  ['6', 'Stocks/ETF sale', '10.06.2024 10:00:00', 'CLOSE BUY 4/10 @ 60.00', 'PKO.PL', '239.00'],
  ['7', 'close trade', '11.06.2024 10:00:00', 'CLOSE BUY 1 @ 100', 'US500', '12.00'],
  ['', 'Total', '', '', '', '3378.54'],
];

test('XTB cash operations', () => {
  assert.equal(detectBroker(XTB), 'xtb');
  const { transactions: t, errors, notes, accountCurrency } = parseXTB(XTB, { portfolioId: 'p' });
  assert.equal(accountCurrency, 'PLN');
  assert.deepEqual(errors, []);
  assert.ok(notes.some((n) => /CFD/.test(n)));
  assert.deepEqual(t.map((x) => x.type), ['DEPOSIT', 'BUY', 'BUY', 'DIVIDEND', 'SELL']);
  const aapl = t[1];
  assert.deepEqual(aapl, { portfolioId: 'p', date: '2024-03-04', type: 'BUY', ticker: 'AAPL', quantity: 10, price: 170.5, currency: 'USD', fee: 0, settleAmount: 6820, settleCurrency: 'PLN' });
  assert.equal(t[2].ticker, 'PKO.WA'); assert.equal(t[2].fee, 0);
  // dividend: 10 shares * 0.25 USD gross, PLN 10.05 gross, PLN 1.51 tax
  const div = t[3];
  assert.equal(div.currency, 'USD'); close(div.amount, 2.5); close(div.settleAmount, 8.54); close(div.tax, 1.51 * 2.5 / 10.05);
  assert.equal(div._settleGross, undefined);
  // sale: 4 * 60 = 240 - 239 received -> 1 PLN fee
  close(t[4].fee, 1);
});

const DEGIRO_TX = `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value,,Exchange rate,Transaction and/or third party fees,,Total,,Order ID
05-03-2024,15:40,APPLE INC,US0378331005,NDQ,XNAS,10,170.50,USD,-1705.00,USD,-1570.12,EUR,1.0859,-2.00,EUR,-1572.12,EUR,abc
06-03-2024,09:10,SAP SE,DE0007164600,XET,XETA,-3,180.00,EUR,540.00,EUR,540.00,EUR,,-3.90,EUR,536.10,EUR,def`;

test('Degiro transactions', () => {
  const rows = table(DEGIRO_TX);
  assert.equal(detectBroker(rows), 'degiro-transactions');
  const { transactions: t, errors } = parseDegiroTransactions(rows, { portfolioId: 'p', isinMap: { DE0007164600: 'SAP.DE' } });
  assert.deepEqual(errors, []);
  assert.equal(t[0].ticker, 'ISIN:US0378331005');
  assert.equal(t[0].currency, 'USD'); assert.equal(t[0].settleAmount, 1572.12); assert.equal(t[0].settleCurrency, 'EUR');
  assert.equal(t[1].type, 'SELL'); assert.equal(t[1].ticker, 'SAP.DE'); assert.equal(t[1].fee, 3.9); assert.equal(t[1].settleAmount, undefined);
});

const DEGIRO_ACC = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
16-05-2024,07:00,15-05-2024,APPLE INC,US0378331005,Dividend Tax,,USD,-0.38,USD,2.12,
16-05-2024,07:00,15-05-2024,APPLE INC,US0378331005,Dividend,,USD,2.50,USD,2.50,
01-03-2024,10:00,01-03-2024,,,iDEAL Deposit,,EUR,2000.00,EUR,2000.00,
05-03-2024,15:40,05-03-2024,APPLE INC,US0378331005,Buy 10 APPLE INC@170.5 USD,,USD,-1705.00,USD,0,abc
01-04-2024,10:00,01-04-2024,,,DEGIRO Exchange Connection Fee 2024,,EUR,-2.50,EUR,1997.50,`;

test('Degiro account statement', () => {
  const rows = table(DEGIRO_ACC);
  assert.equal(detectBroker(rows), 'degiro-account');
  const { transactions: t, errors } = parseDegiroAccount(rows, { portfolioId: 'p', isinMap: { US0378331005: 'AAPL' } });
  assert.deepEqual(errors, []);
  assert.deepEqual(t.map((x) => x.type), ['DEPOSIT', 'FEE', 'DIVIDEND']);
  assert.equal(t[2].ticker, 'AAPL'); close(t[2].amount, 2.5); close(t[2].tax, 0.38);
});

const IBKR = `Statement,Header,Field Name,Field Value
Statement,Data,Title,Activity Statement
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,AAPL,"2024-03-05, 10:30:00",10,170.5,171,-1705,-1,1706,0,5,O
Trades,Data,Order,Stocks,EUR,SAP,"2024-03-06, 09:00:00",-3,180,181,540,-1.25,500,38.75,0,C
Trades,SubTotal,,Stocks,USD,AAPL,,10,,,-1705,-1,,,,
Trades,Data,Order,Equity and Index Options,USD,SPY 240621C500,"2024-03-07, 10:00:00",1,2.5,2.4,-250,-0.7,,,,O
Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2024-05-16,AAPL(US0378331005) Cash Dividend USD 0.25 per Share (Ordinary Dividend),2.5
Dividends,Data,Total,,,2.5
Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,USD,2024-05-16,AAPL(US0378331005) Cash Dividend USD 0.25 per Share - US Tax,-0.38,
Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount
Deposits & Withdrawals,Data,EUR,2024-03-01,Electronic Fund Transfer,5000
Deposits & Withdrawals,Data,Total,,,5000
Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Listing Exch,Multiplier,Type,Code
Financial Instrument Information,Data,Stocks,AAPL,APPLE INC,265598,US0378331005,NASDAQ,1,COMMON,
Financial Instrument Information,Data,Stocks,SAP,SAP SE,14204,DE0007164600,IBIS,1,COMMON,`;

test('Interactive Brokers activity statement', () => {
  const rows = parseCSV(IBKR).rows; // header row is the Statement header; parse all lines
  const all = [parseCSV(IBKR).headers, ...rows];
  assert.equal(detectBroker(all), 'ibkr');
  const { transactions: t, errors, notes } = parseIBKR(all, { portfolioId: 'p' });
  assert.deepEqual(errors, []);
  assert.ok(notes.some((n) => /options/.test(n)));
  assert.deepEqual(t.map((x) => `${x.type}:${x.ticker || ''}`), ['DEPOSIT:', 'BUY:AAPL', 'SELL:SAP.DE', 'DIVIDEND:AAPL']);
  assert.equal(t[1].fee, 1); assert.equal(t[2].quantity, 3); close(t[3].tax, 0.38);
});

const REVOLUT = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-03-01T10:00:00.000Z,,CASH TOP-UP,,,USD 1000,USD,1.0
2024-03-05T15:40:00.000Z,AAPL,BUY - MARKET,2,USD 170.50,USD 341.99,USD,1.0
2024-05-16T12:00:00.000Z,AAPL,DIVIDEND,,,USD 0.43,USD,1.0
2024-06-10T08:00:00.000Z,NVDA,STOCK SPLIT,9,,,USD,1.0`;

test('Revolut statement', () => {
  const rows = table(REVOLUT);
  assert.equal(detectBroker(rows), 'revolut');
  const { transactions: t, errors, notes } = parseRevolut(rows, { portfolioId: 'p' });
  assert.deepEqual(errors, []);
  assert.deepEqual(t.map((x) => x.type), ['DEPOSIT', 'BUY', 'DIVIDEND']);
  close(t[1].fee, 0.99); assert.equal(t[1].price, 170.5); close(t[2].amount, 0.43);
  assert.ok(notes.some((n) => /split/i.test(n)));
});

test('unknown file is not detected', () => {
  assert.equal(detectBroker(table('date,type,ticker\n2024-01-01,BUY,AAPL')), null);
});
