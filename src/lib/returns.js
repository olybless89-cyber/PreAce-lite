// src/lib/returns.js
//
// Single source of truth for ROI math, supporting daily / weekly / monthly /
// yearly rate periods (not just daily). Import this everywhere returns are
// calculated or displayed — the user dashboard, the admin profile page,
// any future payout/accrual job — so they never disagree.
//
// This REPLACES the earlier daily-only version from the roi-admin-update
// bundle, if you deployed that one. Same file path, drop-in upgrade.

export const ROI_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];

const PERIOD_DAYS = {
  daily: 1,
  weekly: 7,
  monthly: 30,   // approximate — adjust to true calendar months if you need
  yearly: 365,   // exact-day precision later
};

export function isValidPeriod(period) {
  return ROI_PERIODS.includes(period);
}

/** Amount credited each time one full period elapses. */
export function computeReturnPerPeriod(investmentAmount, ratePercent) {
  return (Number(investmentAmount) * Number(ratePercent)) / 100;
}

/**
 * Total accrued return since the rate's effective date, as of a given date.
 * Whole periods only (a partial period in progress doesn't count yet).
 */
export function computeAccruedReturn({ investmentAmount, ratePercent, period, effectiveDate, asOfDate = new Date() }) {
  if (!ratePercent || !isValidPeriod(period) || !effectiveDate) return 0;

  const start = new Date(effectiveDate);
  const periodDays = PERIOD_DAYS[period];
  const elapsedDays = Math.max(0, Math.floor((asOfDate - start) / (1000 * 60 * 60 * 24)));
  const periodsElapsed = Math.floor(elapsedDays / periodDays);
  const perPeriod = computeReturnPerPeriod(investmentAmount, ratePercent);

  return perPeriod * periodsElapsed;
}

/** Human label, e.g. "2.5%/week" — for display on the dashboard/admin page. */
export function formatRateLabel(ratePercent, period) {
  const suffix = { daily: '/day', weekly: '/week', monthly: '/month', yearly: '/year' }[period] ?? '';
  return `${ratePercent}%${suffix}`;
}
