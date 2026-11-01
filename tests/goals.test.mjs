import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, monthsToGoal, fireNumber, monthlyNeeded } from '../docs/js/goals.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('projection compounds monthly and tracks contributions', () => {
  const p = project({ start: 1000, monthly: 0, annualReturn: 0.1, years: 2 });
  close(p[2].value, 1210, 1e-6);
  const q = project({ start: 0, monthly: 100, annualReturn: 0, years: 1, inflation: 0.1 });
  close(q[1].value, 1200); close(q[1].contributed, 1200); close(q[1].real, 1200 / 1.1);
});

test('months to goal, FIRE number, needed contribution', () => {
  assert.equal(monthsToGoal({ start: 0, monthly: 100, annualReturn: 0, goal: 1200 }), 12);
  assert.equal(monthsToGoal({ start: 5000, goal: 1000 }), 0);
  assert.equal(monthsToGoal({ start: 0, monthly: 0, goal: 1 , maxYears: 5}), null);
  assert.equal(fireNumber(4000, 0.04), 1200000);
  const m = monthlyNeeded({ start: 0, annualReturn: 0, goal: 1200, years: 1 });
  close(m, 100, 0.01);
});
