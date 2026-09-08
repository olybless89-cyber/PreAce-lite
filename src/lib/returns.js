// src/lib/returns.js
//
// Single source of truth for ROI math, so the user dashboard, the admin
// panel, and any backend accrual job all agree on the same numbers.
// Import this everywhere returns are calculated or displayed — don't
// re-implement the formula in more than one place.

/**
 * Which rate actually applies to this investment: its own negotiated
 * override if one is set, otherwise the platform default.
 */
export function getEffectiveRoiPercent(investment, platformDefaultPercent) {
  const override = investment.roi_rate_percent
  if (override !== null && override !== undefined && override !== '') {
    return Number(override)
  }
  return Number(platformDefaultPercent)
}

/** Daily return in currency units for a given invested amount + rate. */
export function computeDailyReturn(investmentAmount, roiRatePercent) {
  return (Number(investmentAmount) * Number(roiRatePercent)) / 100
}

/**
 * Total accrued return since the investment started, as of a given date.
 * Whole days only — adjust if you want to accrue by fractional day/hour.
 */
export function computeAccruedReturn(investment, roiRatePercent, asOfDate = new Date()) {
  const start = new Date(investment.created_at ?? investment.start_date)
  const days = Math.max(0, Math.floor((asOfDate - start) / (1000 * 60 * 60 * 24)))
  const daily = computeDailyReturn(investment.amount, roiRatePercent)
  return daily * days
}
