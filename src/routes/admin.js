import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, sql } from '../db/client.js';
import {
  users, transactions, ledger, plans as plansT, traders as tradersT,
  traderTrades, notifications, investments, kycSubmissions, mailLog, sessions,
} from '../db/schema.js';
import { requireAdmin, createSession, hash } from '../lib/auth.js';
import { render, eta } from '../lib/view.js';
import { traderStats, portfolio, balance } from '../lib/stats.js';
import {
  getWallets, setWallets, getSiteConfig, setSiteConfig,
  listPaymentMethods, addPaymentMethod, updatePaymentMethod, deletePaymentMethod, methodValues,
} from '../lib/settings.js';
import { BUCKETS, creditDebit, clearAccount, setWithdrawalCode, clearWithdrawalCode } from '../lib/finance.js';
import { activeRecoverySnapshot } from '../lib/balance.js';
import {
  classifyAccount, createSnapshot, verifySnapshot, addRecoveryNote, upsertInvestmentPlanConfig,
} from '../lib/recovery.js';
import {
  mailDepositConfirmed, mailDepositDeclined, mailWithdrawalSent, mailWithdrawalDeclined,
  mailKycApproved, mailKycRejected, mailAdminMessage,
  getMailConfig, setMailConfig, sendTestMail,
} from '../lib/mail.js';
import * as fmt from '../lib/money.js';

export const admin = new Hono();
admin.use('*', requireAdmin);

const svg = (d) => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">${d}</svg>`;
const NAV = [
  { label: 'Overview', items: [
    { href: '/admin', label: 'Dashboard', icon: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>') },
  ]},
  { label: 'Money', items: [
    { href: '/admin/deposits',    label: 'Deposits',    icon: svg('<path d="M12 3v13M6 11l6 6 6-6M4 21h16"/>') },
    { href: '/admin/withdrawals', label: 'Withdrawals', icon: svg('<path d="M12 21V8M6 13l6-6 6 6M4 3h16"/>') },
    { href: '/admin/plans',       label: 'Plans',       icon: svg('<path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>') },
    { href: '/admin/payment-methods', label: 'Payment methods', icon: svg('<rect x="2" y="6" width="20" height="13" rx="2.5"/><path d="M16 12h4M2 10h20"/>') },
  ]},
  { label: 'People', items: [
    { href: '/admin/users',   label: 'Users',   icon: svg('<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.9"/>') },
    { href: '/admin/recovery', label: 'Recovery', icon: svg('<path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 3L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>') },
    { href: '/admin/kyc',     label: 'KYC review', icon: svg('<path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>') },
    { href: '/admin/traders', label: 'Traders', icon: svg('<path d="M3 17l5-6 4 4 6-8"/><path d="M3 21h18"/>') },
  ]},
  { label: 'System', items: [
    { href: '/admin/mail', label: 'Mail outbox', icon: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>') },
    { href: '/admin/mail/compose', label: 'Send mail', icon: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>') },
    { href: '/admin/mail/settings', label: 'Mail settings', icon: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>') },
    { href: '/admin/audit', label: 'Audit log', icon: svg('<path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>') },
    { href: '/admin/site', label: 'Site settings', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18 15 15 0 010-18"/>') },
  ]},
];

const shell = async (c, view, data, title) => {
  const u = c.get('user');
  const body = eta.render(view, { ...fmt, ...data, user: u, csrf: c.get('csrf') });
  // Longest-prefix match so /admin/mail/compose lights "Send mail", not "Mail outbox".
  const p = c.req.path;
  const activeHref = NAV.flatMap((g) => g.items).map((i) => i.href)
    .filter((h) => p === h || p.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0] || null;
  return render(c, 'layouts/admin', { body, title, nav: NAV, activeHref });
};

/* ---------------- TEMP status dump for Tammy (read-only, remove after verify) ---------------- */
admin.get("/admin/_diag/tammy", async (c) => {
  const EMAIL = "tammy.riley@preace-lite.com";
  const [u] = await sql`select id, email, account_class, recovery_status, status, created_at from users where email = ${EMAIL}`;
  if (!u) return c.json({ error: "user not found" });
  const uid = u.id;
  const [marker] = await sql`select value from settings where key = "one_time_tammy_convert_v1"`;
  const [depTx] = await sql`select count(*)::text n, coalesce(sum(amount),0)::text amt from transactions where user_id = ${uid}and type = "deposit"`;
  const [led] = await sql`select count(*)::text n, coalesce(sum(amount),0)::text amt from ledger where user_id = ${uid}`;
  const [invC] = await sql`select count(*)::text n from investments where user_id = ${uid}`;
  const investments = await sql`select id, plan_id, principal::text, accrued::text, periods_paid, status, started_at, last_accrual_at, matures_at from investments where user_id = ${uid} order by id`;
  const ledgerRows = await sql`select id, account, kind, amount::text, ref_type, ref_id, memo, created_at from ledger where user_id = ${uid} order by id`;
  return c.json({ uid, user: u, marker: marker ? marker.value : null, depTx, ledger: led, invCount: invC.n, investments: investments.length ? investments : null, ledgerRows: ledgerRows.length ? ledgerRows : null });
});
