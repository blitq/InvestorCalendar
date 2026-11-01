import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, detectColumns, parseNumber, parseDate, parseType, rowsToTransactions, toCSV } from '../docs/js/importers.js';

test('parseNumber handles EU and US formats', () => {
  assert.equal(parseNumber('1 234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('(3.5)'), -3.5);
  assert.equal(parseNumber('10.5 USD'), 10.5);
  assert.equal(parseNumber(''), null);
});

test('parseDate', () => {
  assert.equal(parseDate('2024-03-05'), '2024-03-05');
  assert.equal(parseDate('05.03.2024 14:33:01'), '2024-03-05');
  assert.equal(parseDate('05/03/2024'), '2024-03-05');
  assert.equal(parseDate('05/03/2024', { monthFirst: true }), '2024-05-03');
  assert.equal(parseDate('12/31/2024'), '2024-12-31');
  assert.equal(parseDate('nonsense'), null);
});

test('parseType (EN + PL)', () => {
  assert.equal(parseType('Kupno'), 'BUY');
  assert.equal(parseType('SPRZEDAŻ'), 'SELL');
  assert.equal(parseType('Dywidenda'), 'DIVIDEND');
  assert.equal(parseType('Market buy'), 'BUY');
  assert.equal(parseType('xyz'), null);
});

test('Polish semicolon CSV end to end', () => {
  const csv = '﻿Data;Typ;Walor;Ilość;Cena;Prowizja;Waluta;Kwota\n' +
    '05.03.2024;Kupno;PKO;10;55,20;3,00;PLN;\n' +
    '06.03.2024;Sprzedaż;PKO;-4;60,00;1,5;PLN;\n' +
    '2024-07-01;Dywidenda;PKO;;;;PLN;"18,60"\n' +
    'bad;Kupno;PKO;1;1;;PLN;\n';
  const { headers, rows, delimiter } = parseCSV(csv);
  assert.equal(delimiter, ';');
  const m = detectColumns(headers);
  assert.equal(m.date, 0); assert.equal(m.type, 1); assert.equal(m.ticker, 2); assert.equal(m.quantity, 3);
  const { transactions, errors } = rowsToTransactions(rows, m, { portfolioId: 'p', tickerSuffix: '.WA' });
  assert.equal(errors.length, 1);
  assert.equal(transactions.length, 3);
  assert.deepEqual(transactions[0], { portfolioId: 'p', date: '2024-03-05', type: 'BUY', currency: 'PLN', ticker: 'PKO.WA', quantity: 10, price: 55.2, fee: 3 });
  assert.equal(transactions[1].type, 'SELL');
  assert.equal(transactions[1].quantity, 4);
  assert.equal(transactions[2].amount, 18.6);
});

test('export → import round trip', () => {
  const txs = [{ portfolioId: 'a', date: '2024-01-02', type: 'BUY', ticker: 'AAPL', quantity: 1, price: 100, fee: 1, currency: 'USD', note: 'hello, "world"' }];
  const csv = toCSV(txs, [{ id: 'a', name: 'Main' }]);
  const { headers, rows } = parseCSV(csv);
  const { transactions } = rowsToTransactions(rows, detectColumns(headers), { portfolioId: 'a' });
  assert.deepEqual(transactions[0], txs[0]);
});

test('settlement columns round trip', () => {
  const txs = [{ portfolioId: 'a', date: '2024-01-02', type: 'BUY', ticker: 'AAPL', quantity: 2, price: 100, fee: 0, currency: 'USD', settleAmount: 810.5, settleCurrency: 'PLN' }];
  const { headers, rows } = parseCSV(toCSV(txs, [{ id: 'a', name: 'Main' }]));
  const { transactions } = rowsToTransactions(rows, detectColumns(headers), { portfolioId: 'a' });
  assert.deepEqual(transactions[0], txs[0]);
});

test('CONVERSION rows import with target amount and currency', () => {
  const { headers, rows } = parseCSV('date,type,amount,currency,toAmount,toCurrency\n2024-01-02,Wymiana walut,4000,PLN,990,USD\n2024-01-03,conversion,10,PLN,,');
  const { transactions, errors } = rowsToTransactions(rows, detectColumns(headers), { portfolioId: 'p' });
  assert.deepEqual(transactions[0], { portfolioId: 'p', date: '2024-01-02', type: 'CONVERSION', currency: 'PLN', amount: 4000, toAmount: 990, toCurrency: 'USD' });
  assert.equal(errors.length, 1);
});

test('mBank-style export in Windows-1250 with GPW short names', async () => {
  const { decodeBytes, gpwTicker } = await import('../docs/js/importers.js');
  // "Czas transakcji;Walor;Giełda;K/S;Liczba;Kurs;Waluta;Prowizja" encoded in cp1250 (ł = 0xB3)
  const head = 'Czas transakcji;Walor;Giełda;K/S;Liczba;Kurs;Waluta;Prowizja\n';
  const body = '05.03.2024 10:01:02;PKNORLEN;WWA-GPW;K;10;63,50;PLN;3,00\n06.03.2024 11:00:00;ETFBW20TR;WWA-GPW;S;2;120,00;PLN;1,00\n';
  const bytes = Uint8Array.from([...head + body].map((c) => (c === 'ł' ? 0xb3 : c.charCodeAt(0))));
  const text = decodeBytes(bytes);
  assert.ok(text.includes('Giełda'));
  const { headers, rows } = parseCSV(text);
  const m = detectColumns(headers);
  const { transactions, errors } = rowsToTransactions(rows, m, { portfolioId: 'p', currency: 'PLN' });
  assert.deepEqual(errors, []);
  assert.deepEqual(transactions.map((t) => [t.type, t.ticker, t.quantity, t.price, t.fee]), [['BUY', 'PKN.WA', 10, 63.5, 3], ['SELL', 'ETFBW20TR.WA', 2, 120, 1]]);
  assert.equal(gpwTicker('cd projekt'.replace(' ', '')), 'CDR.WA');
  assert.equal(gpwTicker('AAPL'), null);
  assert.equal(decodeBytes(new TextEncoder().encode('﻿zażółć')), 'zażółć');
});
