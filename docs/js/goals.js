// Goal / FIRE projections. Pure functions, amounts in today's money when `inflation` is given.

/**
 * Month-by-month projection.
 * opts: { start, monthly, annualReturn (0.06), inflation (0.03), years, contributionGrowth (yearly, e.g. 0.03) }
 * Returns yearly points: [{ year, value, real, contributed }]
 */
export function project({ start = 0, monthly = 0, annualReturn = 0.06, inflation = 0, years = 30, contributionGrowth = 0 } = {}) {
  const rm = Math.pow(1 + annualReturn, 1 / 12) - 1;
  let v = start, contributed = start, pay = monthly;
  const out = [{ year: 0, value: v, real: v, contributed }];
  for (let m = 1; m <= years * 12; m++) {
    v = v * (1 + rm) + pay;
    contributed += pay;
    if (m % 12 === 0) {
      const y = m / 12;
      out.push({ year: y, value: v, real: v / Math.pow(1 + inflation, y), contributed });
      pay *= 1 + contributionGrowth;
    }
  }
  return out;
}

/** Months until `goal` (in today's money) is reached, or null within maxYears. */
export function monthsToGoal({ start = 0, monthly = 0, annualReturn = 0.06, inflation = 0, contributionGrowth = 0, goal, maxYears = 80 }) {
  if (start >= goal) return 0;
  const rm = Math.pow(1 + annualReturn, 1 / 12) - 1;
  const im = Math.pow(1 + inflation, 1 / 12);
  let v = start, pay = monthly, defl = 1;
  for (let m = 1; m <= maxYears * 12; m++) {
    v = v * (1 + rm) + pay;
    defl *= im;
    if (v / defl >= goal) return m;
    if (m % 12 === 0) pay *= 1 + contributionGrowth;
  }
  return null;
}

/** Portfolio needed for a monthly passive income at a safe withdrawal rate (e.g. 4%). */
export const fireNumber = (monthlyIncome, withdrawalRate = 0.04) => (monthlyIncome * 12) / withdrawalRate;

/** Monthly contribution needed to reach `goal` (today's money) in `years`. Bisection on the payment. */
export function monthlyNeeded({ start = 0, annualReturn = 0.06, inflation = 0, contributionGrowth = 0, goal, years }) {
  let lo = 0, hi = Math.max(goal, 1);
  const reach = (p) => (monthsToGoal({ start, monthly: p, annualReturn, inflation, contributionGrowth, goal, maxYears: years }) !== null);
  if (reach(0)) return 0;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (reach(mid)) hi = mid; else lo = mid; }
  return hi;
}
