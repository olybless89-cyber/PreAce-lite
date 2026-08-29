/* =================================================================
   Recovery console operations
   -----------------------------------------------------------------
   Everything an admin can do about a recovered account. Every
   mutation is:
     - validated server-side
     - written inside the same transaction as the audit_log row
     - mirrored to recovery_notes so there is an in-app trail

   Balances are NEVER touched here. Snapshots are display data. If a
   genuine ledger balance needs fixing, admins use the normal
   credit/debit flow (src/lib/finance.js) which audit-logs and posts
   real ledger lines.
   ================================================================= */

import crypto from 'node:crypto';
import { sql } from '../db/client.js';
import { RECOVERY_TEST, PRODUCTION } from './balance.js';

const ipOf = (c) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null;

/* Classify an account as recovery_test (or back to production). The flag is
   what switches the BalanceService to recovery_display_balance. */
export async function classifyAccount(c, admin, userId, kind, reason) {
  const next = kind === 'recovery_test' ? RECOVERY_TEST : PRODUCTION;
  return sql.begin(async (tx) => {
    const [prev] = await tx`select account_class, recovery_status from users where id = ${userId}`;
    if (!prev) throw new Error('User not found.');
    await tx`update users set account_class = ${next},
               recovery_status = ${next === RECOVERY_TEST ? 'pending' : prev.recovery_status}
             where id = ${userId}`;
    const ref = 'cls-' + crypto.randomBytes(5).toString('hex');
    await tx`insert into audit_log (admin_id, user_id, action, category, reason, reference, ip)
      values (${admin.id}, ${userId}, 'recovery_classify', ${'account_class'}, ${reason || null}, ${ref}, ${ipOf(c)})`;
    await tx`insert into recovery_notes (user_id, kind, body, created_by)
      values (${userId}, 'classify',
              ${`Account class set to ${next} (${reason || 'no reason given'})`}, ${admin.id})`;
    return { from: prev.account_class, to: next, ref };
  });
}

/* Create a new recovery snapshot header + asset rows. Replaces nothing —
   the newest snapshot is active. display_total is validated/derived so a
   typo can't surface a headline number that contradicts the rows. */
export async function createSnapshot(c, admin, userId, { total, btcPrice, source, notes, assets }) {
  const cleanAssets = (assets || []).filter((a) => a.asset && Number(a.value) > 0);
  if (!cleanAssets.length) throw new Error('Add at least one asset with a value.');

  // The sum of asset values is authoritative for display_total.
  const derivedTotal = cleanAssets.reduce((s, a) => s + Number(a.value), 0);
  const requested = Number(total) || 0;
  if (requested > 0 && Math.abs(requested - derivedTotal) > 0.01) {
    throw new Error(`Total (${requested.toFixed(2)}) does not match the sum of assets (${derivedTotal.toFixed(2)}).`);
  }

  return sql.begin(async (tx) => {
    const [h] = await tx`
      insert into user_balance_snapshots
        (user_id, snapshot_type, status, display_total, btc_price, source, notes, created_by)
      values (${userId}, 'recovery', 'draft', ${String(derivedTotal)},
              ${btcPrice && Number(btcPrice) > 0 ? String(Number(btcPrice)) : null},
              ${String(source || 'admin_recovery')}, ${notes || null}, ${admin.id})
      returning id, display_total::text display_total`;
    for (const a of cleanAssets) {
      await tx`
        insert into user_balance_snapshot_assets
          (snapshot_id, asset, asset_name, display_balance, display_quantity, sort_order)
        values (${h.id}, ${String(a.asset).toUpperCase()}, ${String(a.name || a.asset).toUpperCase()},
                ${String(Number(a.value))},
                ${a.qty !== undefined && a.qty !== null && String(a.qty) !== '' ? String(Number(a.qty)) : null},
                ${Number(a.sort) || 0})`;
    }
    const ref = 'snap-' + crypto.randomBytes(5).toString('hex');
    await tx`insert into audit_log (admin_id, user_id, action, category, amount, reason, reference, ip)
      values (${admin.id}, ${userId}, 'recovery_snapshot_create', ${'snapshot'}, ${String(derivedTotal)},
              ${notes || 'Recovery snapshot created'}, ${ref}, ${ipOf(c)})`;
    await tx`insert into recovery_notes (user_id, kind, body, created_by)
      values (${userId}, 'note',
              ${`Snapshot #${h.id} created — display total $${Number(h.display_total).toFixed(2)}${notes ? ` (${notes})` : ''}`}, ${admin.id})`;
    return { id: h.id, total: Number(h.display_total), ref };
  });
}

/* Verify a snapshot: flips status to 'verified', records who/when. */
export async function verifySnapshot(c, admin, userId, snapshotId, reason) {
  return sql.begin(async (tx) => {
    const [s] = await tx`select * from user_balance_snapshots where id = ${snapshotId} and user_id = ${userId}`;
    if (!s) throw new Error('Snapshot not found.');
    const was = s.status;
    await tx`update user_balance_snapshots
      set status = 'verified', verified_by = ${admin.id}, verified_at = now(), updated_at = now()
      where id = ${snapshotId}`;
    await tx`update users set recovery_status = 'verified' where id = ${userId}`;
    const ref = 'vfy-' + crypto.randomBytes(5).toString('hex');
    await tx`insert into audit_log (admin_id, user_id, action, category, reason, reference, ip)
      values (${admin.id}, ${userId}, 'recovery_snapshot_verify', ${'snapshot'}, ${reason || null}, ${ref}, ${ipOf(c)})`;
    await tx`insert into recovery_notes (user_id, kind, body, created_by)
      values (${userId}, 'note', ${`Snapshot #${snapshotId} verified (was ${was})`}, ${admin.id})`;
    return { id: snapshotId, ref };
  });
}

/* Add an internal working note. */
export async function addRecoveryNote(c, admin, userId, text) {
  const body = String(text || '').trim().slice(0, 2000);
  if (!body) throw new Error('Write a note first.');
  const [n] = await sql`
    insert into recovery_notes (user_id, kind, body, created_by)
    values (${userId}, 'note', ${body}, ${admin.id})
    returning id, user_id, kind, body, created_by, created_at`;
  await sql`insert into audit_log (admin_id, user_id, action, category, reason, ip)
    values (${admin.id}, ${userId}, 'recovery_note', ${'note'}, ${body.slice(0, 300)}, ${ipOf(c)})`;
  return n;
}

/* Record (or update) the intended investment-plan configuration. This is a
   recovery reference — NO ledger rows, NO investments rows are created. */
export async function upsertInvestmentPlanConfig(c, admin, userId, { amount, frequency, months, notes }) {
  const amt = Math.round(Number(amount) * 100) / 100;
  const dur = Math.max(1, Math.min(120, Number(months) || 7));
  const freq = String(frequency || 'biweekly').toLowerCase();
  if (!['weekly', 'biweekly', 'monthly'].includes(freq)) throw new Error('Frequency must be weekly, biweekly or monthly.');
  if (!(amt > 0)) throw new Error('Contribution amount must be greater than zero.');

  return sql.begin(async (tx) => {
    const [existing] = await tx`select * from recovery_investment_plan where user_id = ${userId} order by id desc limit 1`;
    if (existing) {
      await tx`update recovery_investment_plan
        set contribution_amount = ${amt}, frequency = ${freq}, duration_months = ${dur},
            status = 'recovery_reference', notes = ${notes || null}
        where id = ${existing.id}`;
    } else {
      await tx`
        insert into recovery_investment_plan
          (user_id, contribution_amount, frequency, duration_months, status, source, notes, created_by)
        values (${userId}, ${amt}, ${freq}, ${dur}, 'recovery_reference', 'admin_recovery',
                ${notes || null}, ${admin.id})`;
    }
    const ref = 'plan-' + crypto.randomBytes(5).toString('hex');
    await tx`insert into audit_log (admin_id, user_id, action, category, amount, reason, reference, ip)
      values (${admin.id}, ${userId}, 'recovery_plan_config', ${'plan_reference'}, ${amt},
              ${`Intended plan: $${amt} per ${freq}, ${dur} months${notes ? ` — ${notes}` : ''}`}, ${ref}, ${ipOf(c)})`;
    await tx`insert into recovery_notes (user_id, kind, body, created_by)
      values (${userId}, 'plan_config',
              ${`Plan configuration recorded: $${amt} every ${freq} for ${dur} months (recovery reference, no payments created)`}, ${admin.id})`;
    return { ref };
  });
}