import { test } from 'node:test';
import assert from 'node:assert/strict';

// report.js imports DOM helpers lazily only inside functions, so it loads in Node
const { periodRange } = await import('../docs/js/views/report.js');

test('periodRange for month, quarter and year, clipped to today', () => {
  assert.deepEqual(periodRange('2024-02', '2026-01-01'), { start: '2024-02-01', end: '2024-02-29', before: '2024-01-31' });
  assert.deepEqual(periodRange('2025-Q4', '2026-01-01'), { start: '2025-10-01', end: '2025-12-31', before: '2025-09-30' });
  assert.deepEqual(periodRange('2026', '2026-03-15'), { start: '2026-01-01', end: '2026-03-15', before: '2025-12-31' });
});
