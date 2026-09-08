// src/routes/admin-user-roi.js
//
// POST /admin/users/:id/roi — sets or updates a specific client's
// invested amount + ROI rate/period, after the legal agreement is signed.
// Meant to be used from the "Set investment & ROI" section pasted into
// views/admin/user.eta (see views/admin/_roi-set-form.eta + README.md).
//
// I've modeled the shape of this handler on the real pattern already in
// your src/routes/admin.js (the /admin/users/:id/withdrawal-code handler:
// `const me = c.get('user')`, `const id = c.req.param('id')`, redirect to
// `/admin/users/${id}?ok=1&m=...`) so it behaves consistently with your
// other admin actions.
//
// What I DON'T know for certain and have left as TODO:
//   - Whether this project's DB calls in admin.js use a raw `sql` tagged
//     template (postgres.js/Neon style) or the Drizzle query builder —
//     I've seen both patterns used in different parts of your codebase.
//     I've written the primary path using the `sql` tagged-template style
//     since that's what your withdrawal-code and transaction-approval
//     handlers use, with a Drizzle alternative commented below it.
//   - The exact import path for `sql` / your db client and for `notify()`
//     (both used elsewhere in admin.js) — fill in the two imports below.

import { Hono } from 'hono'
// TODO: match these two imports to whatever admin.js already imports.
// import { sql } from '../db/client.js'
// import { notify } from '../lib/notify.js'
import { isValidPeriod } from '../lib/returns.js'

const adminUserRoi = new Hono()

adminUserRoi.post('/admin/users/:id/roi', async (c) => {
  const me = c.get('user') // TODO: confirm this matches admin.js's pattern (it does, per grep)
  const id = c.req.param('id')
  const form = await c.req.parseBody()

  const amount = Number(form.amount)
  const ratePercent = Number(form.rate_percent)
  const period = String(form.period || '')
  const effectiveDate = String(form.effective_date || '')
  const reference = String(form.reference || '').trim() || null
  const reason = String(form.change_reason || '').trim() || null
  const investmentId = form.investment_id ? Number(form.investment_id) : null

  // --- validation ---
  if (Number.isNaN(amount) || amount < 0) {
    return c.redirect(`/admin/users/${id}?e=` + encodeURIComponent('Enter a valid invested amount.'))
  }
  if (Number.isNaN(ratePercent) || ratePercent < 0) {
    return c.redirect(`/admin/users/${id}?e=` + encodeURIComponent('Enter a valid rate percentage.'))
  }
  if (!isValidPeriod(period)) {
    return c.redirect(`/admin/users/${id}?e=` + encodeURIComponent('Choose a valid period (daily/weekly/monthly/yearly).'))
  }
  if (!effectiveDate) {
    return c.redirect(`/admin/users/${id}?e=` + encodeURIComponent('Set an effective date.'))
  }

  // TODO: replace this whole block with your real DB calls. Two options
  // depending on which style admin.js already uses for this table:

  // --- Option A: raw `sql` tagged template (matches your withdrawal-code handler) ---
  //
  // let current = null;
  // if (investmentId) {
  //   [current] = await sql`select roi_rate_percent, roi_rate_period from investments where id = ${investmentId}`;
  // }
  //
  // let finalInvestmentId = investmentId;
  // if (investmentId) {
  //   await sql`
  //     update investments
  //     set amount = ${amount}, roi_rate_percent = ${ratePercent}, roi_rate_period = ${period},
  //         roi_effective_date = ${effectiveDate}, roi_reference = ${reference},
  //         roi_rate_updated_at = now(), roi_rate_updated_by = ${me.id}
  //     where id = ${investmentId}`;
  // } else {
  //   const [row] = await sql`
  //     insert into investments (user_id, amount, status, roi_rate_percent, roi_rate_period,
  //                               roi_effective_date, roi_reference, roi_rate_updated_at, roi_rate_updated_by, created_at)
  //     values (${id}, ${amount}, 'active', ${ratePercent}, ${period}, ${effectiveDate}, ${reference}, now(), ${me.id}, now())
  //     returning id`;
  //   finalInvestmentId = row.id;
  // }
  //
  // await sql`
  //   insert into roi_rate_changes
  //     (investment_id, old_rate_percent, new_rate_percent, old_period, new_period, effective_date, reference, changed_by, reason)
  //   values
  //     (${finalInvestmentId}, ${current?.roi_rate_percent ?? null}, ${ratePercent},
  //      ${current?.roi_rate_period ?? null}, ${period}, ${effectiveDate}, ${reference}, ${me.id}, ${reason})`;
  //
  // await notify({
  //   userId: id, kind: 'info', title: 'Investment terms updated',
  //   body: `Your investment terms were set: ${ratePercent}%/${period}, effective ${effectiveDate}.`,
  // }).catch((e) => console.error('[notify] roi update failed:', e.message));

  console.warn('admin-user-roi POST is a stub — nothing was saved yet. Fill in the DB calls (see comments above):', {
    userId: id, investmentId, amount, ratePercent, period, effectiveDate, reference, reason, changedBy: me?.id,
  })

  return c.redirect(`/admin/users/${id}?ok=1&m=` + encodeURIComponent(
    `Investment & ROI saved: ${ratePercent}%/${period} on $${amount}, effective ${effectiveDate}.`
  ))
})

export default adminUserRoi

// Mount in your main app file, alongside your other route mounts:
//
//   import adminUserRoi from './routes/admin-user-roi.js'
//   app.route('/', adminUserRoi)
//
// (It's safe to mount this even before you've pasted the form into
// user.eta — the route just won't be reachable from the UI yet, and
// visiting it directly does nothing until the DB calls above are filled in.)
