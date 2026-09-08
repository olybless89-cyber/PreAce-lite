// src/routes/admin-roi.js
//
// Admin-only routes for managing ROI rates:
//   GET  /admin/roi-rates            -> list all investments + current rates
//   POST /admin/roi-rates/default    -> change the platform default rate
//   POST /admin/roi-rates/:id        -> set/clear a per-investment override
//
// Every change is written to roi_rate_changes for an audit trail (see
// db/migrations/2026_create_roi_rate_changes.sql) — don't skip that insert
// when you wire up setInvestmentRate/setPlatformDefaultRate below; it's the
// record that shows why a given client's rate is what it is.
//
// As with withdrawal.js, the parts that touch your real auth/DB are
// isolated below as TODOs. requireAdmin() throws on purpose until wired up.

import { Hono } from 'hono'
import { getEffectiveRoiPercent } from '../lib/returns.js'

const adminRoi = new Hono()

// ---------------------------------------------------------------------
// TODO: wire these to your real app
// ---------------------------------------------------------------------

async function requireAdmin(c) {
  // TODO: replace with your real admin auth check (session + role, or
  // however you gate other /admin routes in this project). Should return
  // the admin user object, or throw/redirect if not an admin.
  throw new Error('requireAdmin() is not wired up yet — see src/routes/admin-roi.js')
}

async function listInvestmentsWithUsers(c) {
  // TODO: replace with your real query, joining investments + users.
  //   const db = c.get('db')
  //   return db.query(`
  //     select i.id, i.amount, i.roi_rate_percent, i.status, i.created_at,
  //            u.id as user_id, u.name, u.email
  //     from investments i
  //     join users u on u.id = i.user_id
  //     order by i.created_at desc
  //   `)
  return []
}

async function getPlatformDefaultRate(c) {
  // TODO: replace with your real settings lookup.
  //   const db = c.get('db')
  //   const row = await db.query(`select value from platform_settings where key = 'default_daily_roi_percent'`)
  //   return Number(row.value)
  return 1.0
}

async function setPlatformDefaultRate(c, newRatePercent, adminId, reason) {
  // TODO: replace with your real update + audit insert.
  //   const db = c.get('db')
  //   const current = await getPlatformDefaultRate(c)
  //   await db.query(
  //     `update platform_settings set value = ?, updated_at = now(), updated_by = ? where key = 'default_daily_roi_percent'`,
  //     [newRatePercent, adminId]
  //   )
  //   await db.query(
  //     `insert into roi_rate_changes (investment_id, old_rate_percent, new_rate_percent, changed_by, reason) values (null, ?, ?, ?, ?)`,
  //     [current, newRatePercent, adminId, reason]
  //   )
  console.warn('setPlatformDefaultRate() is a stub — nothing was saved:', { newRatePercent, adminId, reason })
}

async function setInvestmentRate(c, investmentId, newRatePercent, adminId, reason) {
  // TODO: replace with your real update + audit insert. newRatePercent may
  // be null, meaning "clear the override, fall back to the platform default".
  //   const db = c.get('db')
  //   const current = await db.query(`select roi_rate_percent from investments where id = ?`, [investmentId])
  //   await db.query(
  //     `insert into roi_rate_changes (investment_id, old_rate_percent, new_rate_percent, changed_by, reason) values (?, ?, ?, ?, ?)`,
  //     [investmentId, current?.roi_rate_percent ?? null, newRatePercent, adminId, reason]
  //   )
  //   await db.query(
  //     `update investments set roi_rate_percent = ?, roi_rate_updated_at = now(), roi_rate_updated_by = ? where id = ?`,
  //     [newRatePercent, adminId, investmentId]
  //   )
  console.warn('setInvestmentRate() is a stub — nothing was saved:', { investmentId, newRatePercent, adminId, reason })
}

// ---------------------------------------------------------------------
// Routes — shouldn't need edits below this line
// ---------------------------------------------------------------------

adminRoi.get('/', async (c) => {
  await requireAdmin(c)
  const investments = await listInvestmentsWithUsers(c)
  const defaultRate = await getPlatformDefaultRate(c)

  const rows = investments.map((inv) => ({
    ...inv,
    effectiveRate: getEffectiveRoiPercent(inv, defaultRate),
  }))

  const updated = c.req.query('updated') ?? null
  const error = c.req.query('error') ?? null

  return c.render
    ? c.render('admin/roi-rates', { investments: rows, defaultRate, updated, error })
    : c.html('TODO: render views/admin/roi-rates.eta with { investments, defaultRate, updated, error }')
})

adminRoi.post('/default', async (c) => {
  const admin = await requireAdmin(c)
  const form = await c.req.parseBody()
  const rate = Number(form.default_rate_percent)
  const reason = form.reason || null

  if (Number.isNaN(rate) || rate < 0) {
    return c.redirect('/admin/roi-rates?error=invalid_rate')
  }

  await setPlatformDefaultRate(c, rate, admin.id, reason)
  return c.redirect('/admin/roi-rates?updated=default')
})

adminRoi.post('/:investmentId', async (c) => {
  const admin = await requireAdmin(c)
  const investmentId = c.req.param('investmentId')
  const form = await c.req.parseBody()

  // Empty string means "clear the override, use the platform default".
  const rate = form.rate_percent === '' ? null : Number(form.rate_percent)
  const reason = form.reason || null

  if (rate !== null && (Number.isNaN(rate) || rate < 0)) {
    return c.redirect('/admin/roi-rates?error=invalid_rate')
  }

  await setInvestmentRate(c, investmentId, rate, admin.id, reason)
  return c.redirect(`/admin/roi-rates?updated=${investmentId}`)
})

export default adminRoi

// Mount alongside your other admin routes in your main app file:
//
//   import adminRoi from './routes/admin-roi.js'
//   app.route('/admin/roi-rates', adminRoi)
//
// and make sure that path sits behind whatever admin-auth middleware your
// other /admin routes already use.
