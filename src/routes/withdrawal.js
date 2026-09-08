// src/routes/withdrawal.js
//
// Hono route module for the new withdrawal flow:
//   GET  /dashboard/withdrawal  -> render withdrawal settings form
//   POST /dashboard/withdrawal  -> save bank details + create a withdrawal
//                                  request (pending / pending_locked)
//
// This intentionally does NOT touch your identity-verification route or
// template — it adds a new page and route. To actually replace the old
// flow, point your "Withdrawal" nav link/button at this route instead of
// the KYC page (see README.md).
//
// Everything that depends on YOUR schema/auth is isolated in the four
// functions at the top, marked TODO. getCurrentUser() throws on purpose
// so this file can't accidentally go live half-wired — fix that first.
//
// Adjust the import path/style below to match how your other route files
// import Hono and render .eta templates (check an existing file in
// src/routes/ for the exact pattern used in this project).

import { Hono } from 'hono'

const withdrawal = new Hono()

// ---------------------------------------------------------------------
// TODO: wire these four functions to your real app
// ---------------------------------------------------------------------

async function getCurrentUser(c) {
  // TODO: replace with however your other dashboard routes get the
  // logged-in user (session cookie, JWT, c.get('user'), etc.)
  throw new Error(
    'getCurrentUser() is not wired up yet — see src/routes/withdrawal.js'
  )
}

async function getSupportedBanks() {
  // TODO: replace with your real bank list — a DB table, a partner API
  // (e.g. Paystack/Flutterwave bank list), or a static list you maintain.
  return [
    { code: 'gtbank', name: 'GTBank' },
    { code: 'access', name: 'Access Bank' },
    { code: 'zenith', name: 'Zenith Bank' },
    { code: 'firstbank', name: 'First Bank' },
    { code: 'uba', name: 'UBA' },
  ]
}

async function getMaturityDateForUser(c, userId) {
  // TODO: replace with your real investment/maturity lookup. Example if
  // you store it per-investment (adjust table/column names to match
  // db/migrations/2026_create_withdrawal_requests.sql and your existing
  // investments table):
  //
  //   const db = c.get('db')
  //   const row = await db.query(
  //     `select maturity_date from investments
  //      where user_id = ? and status = 'active'
  //      order by maturity_date asc limit 1`,
  //     [userId]
  //   )
  //   return row?.maturity_date ?? null
  //
  // Returning null here means "treat as locked, no known unlock date yet"
  // (see isLocked logic below) — swap in your real value.
  return null
}

async function saveWithdrawalRequest(c, { userId, bankCode, accountNumber, accountName, status, unlockAt }) {
  // TODO: replace with your real DB insert, matching whatever client this
  // project uses (raw SQL, an ORM, etc.). Matches the shape of the table in
  // db/migrations/2026_create_withdrawal_requests.sql.
  //
  //   const db = c.get('db')
  //   await db.query(
  //     `insert into withdrawal_requests
  //        (user_id, bank_code, account_number, account_name, status, unlock_at)
  //      values (?, ?, ?, ?, ?, ?)`,
  //     [userId, bankCode, accountNumber, accountName, status, unlockAt]
  //   )
  console.warn('saveWithdrawalRequest() is a stub — nothing was persisted:', {
    userId, bankCode, accountNumber, accountName, status, unlockAt,
  })
}

// ---------------------------------------------------------------------
// Routes — shouldn't need edits below this line
// ---------------------------------------------------------------------

withdrawal.get('/', async (c) => {
  const user = await getCurrentUser(c)
  const banks = await getSupportedBanks()
  const maturityDate = await getMaturityDateForUser(c, user.id)
  const isLocked = !maturityDate || new Date(maturityDate) > new Date()

  const submitted = c.req.query('submitted') === '1'
  const error = c.req.query('error') ?? null

  // TODO: match however your other routes render .eta templates —
  // e.g. c.render(...) if that's set up, or your project's own render
  // helper. Replace the placeholder below.
  return c.render
    ? c.render('dashboard/withdrawal', { user, banks, maturityDate, isLocked, submitted, error })
    : c.html('TODO: render views/dashboard/withdrawal.eta with { user, banks, maturityDate, isLocked, submitted, error }')
})

withdrawal.post('/', async (c) => {
  const user = await getCurrentUser(c)
  const form = await c.req.parseBody()
  const bankCode = form.bank_code
  const accountNumber = form.account_number
  const accountName = form.account_name

  if (!bankCode || !accountNumber || !accountName) {
    return c.redirect('/dashboard/withdrawal?error=missing_fields')
  }

  const maturityDate = await getMaturityDateForUser(c, user.id)
  const isLocked = !maturityDate || new Date(maturityDate) > new Date()

  await saveWithdrawalRequest(c, {
    userId: user.id,
    bankCode,
    accountNumber,
    accountName,
    status: isLocked ? 'pending_locked' : 'pending',
    unlockAt: maturityDate,
  })

  return c.redirect('/dashboard/withdrawal?submitted=1')
})

export default withdrawal

// In your main app file, mount this alongside your other dashboard routes:
//
//   import withdrawal from './routes/withdrawal.js'
//   app.route('/dashboard/withdrawal', withdrawal)
