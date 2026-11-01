import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, mergeStates } from '../docs/js/sync.js';

test('seal/unseal with and without passphrase', async () => {
  const state = { transactions: [{ id: 'a', ticker: 'AAPL' }] };
  assert.deepEqual(await unseal(await seal(state, ''), ''), state);
  const sealed = await seal(state, 'correct horse');
  assert.ok(!sealed.includes('AAPL'));
  assert.deepEqual(await unseal(sealed, 'correct horse'), state);
  await assert.rejects(() => unseal(sealed, 'wrong'), /Wrong passphrase/);
  await assert.rejects(() => unseal(sealed, ''), /encrypted/);
});

test('mergeStates unions by id, tombstones win, newer side wins edits', () => {
  const local = { updatedAt: '2024-02-01', portfolios: [{ id: 'm', name: 'Main' }], transactions: [{ id: '1', price: 10 }, { id: '2', price: 20 }], settings: { baseCurrency: 'PLN' }, deleted: ['3'] };
  const remote = { updatedAt: '2024-01-01', portfolios: [{ id: 'm', name: 'Old name' }, { id: 'i', name: 'IKE' }], transactions: [{ id: '1', price: 9 }, { id: '3', price: 30 }, { id: '4', price: 40 }], settings: { baseCurrency: 'USD', lang: 'pl' }, deleted: [] };
  const m = mergeStates(local, remote);
  assert.deepEqual(m.transactions.map((t) => t.id).sort(), ['1', '2', '4']);
  assert.equal(m.transactions.find((t) => t.id === '1').price, 10);
  assert.equal(m.portfolios.find((p) => p.id === 'm').name, 'Main');
  assert.equal(m.portfolios.length, 2);
  assert.deepEqual(m.settings, { baseCurrency: 'PLN', lang: 'pl' });
  assert.deepEqual(m.deleted, ['3']);
  assert.equal(mergeStates(local, null), local);
});
