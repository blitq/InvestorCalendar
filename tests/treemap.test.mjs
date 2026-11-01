import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squarify } from '../docs/js/treemap.js';

test('squarify fills the box with areas proportional to value', () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ id: i, value: v }));
  const r = squarify(items, 600, 400);
  assert.equal(r.length, 7);
  const area = r.reduce((a, i) => a + i.w * i.h, 0);
  assert.ok(Math.abs(area - 240000) < 1e-6);
  for (const i of r) {
    assert.ok(Math.abs(i.w * i.h - (i.value / 24) * 240000) < 1e-6);
    assert.ok(i.x >= -1e-9 && i.y >= -1e-9 && i.x + i.w <= 600 + 1e-6 && i.y + i.h <= 400 + 1e-6);
  }
  // squarified: no sliver worse than 1:6 for this classic example
  assert.ok(r.every((i) => Math.max(i.w / i.h, i.h / i.w) < 6));
  assert.deepEqual(squarify([{ value: 0 }], 10, 10), []);
});
