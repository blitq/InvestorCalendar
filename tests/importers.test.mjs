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
