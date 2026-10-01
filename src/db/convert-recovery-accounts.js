import 'dotenv/config';
import { sql } from './client.js';
import { getBalanceOverview } from '../lib/balance.js';

/* Convert verified recovery_test accounts to production.
   1. read the balance the user sees now (getBalanceOverview)
   2. add ONE ledger 'adjustment' = shown total - existing ledger total
   3. remove recovery snapshot/plan/notes (backed up first) + set production
   4. read the balance again; if it moved by > 0.01, undo that user
   Default = preview only. Pass --apply to write. */

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--email=')) || '').slice(8);
const TOL = 0.01;
const TOTAL_KEYS = ['total', 'totalBalance', 'total_balance', 'totalUsd',
  'total_usd', 'totalValue', 'equity', 'balance'];
const MEMO = 'Opening balance restored from verified pre-migration records';

function findTotal(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 2) return null;
  for (const k of TOTAL_KEYS) {
    const v = o[k];
    if (v != null && typeof v !== 'object' && !isNaN(Number(v))) {
      return { path: k, value: Number(v) };
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r = findTotal(v, depth + 1);
      if (r) return { path: `${k}.${r.path}`, value: r.value };
    }
  }
  return null;
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const money = (n) => Number(n).toFixed(2).padStart(12);

async function shownTotal(userId, path) {
  const [u] = await sql`select * from users where id = ${userId}`;
  const ov = await getBalanceOverview(u);
  if (path) return { value: Number(getPath(ov, path)), ov };
  const t = findTotal(ov);
  return t ? { ...t, ov } : { value: null, ov };
}

async function main() {
  const filter = ONLY ? sql`and email = ${ONLY}` : sql``;
  const all = await sql`
    select id, email, account_class::text as account_class, recovery_status
      from users where account_class::text = 'recovery_test' ${filter}
     order by id`;
  const ready = all.filter((u) => u.recovery_status === 'verified');
  const pending = all.filter((u) => u.recovery_status !== 'verified');

  console.log(`\nRecovery accounts: ${all.length}  verified: ${ready.length}  not verified: ${pending.length}`);
  for (const u of pending) console.log(`  SKIP (not verified): ${u.email} [${u.recovery_status}]`);

  const plan = [];
  for (const u of ready) {
    const t = await shownTotal(u.id);
    if (t.value == null || isNaN(t.value)) {
      console.log(`  SKIP (can't read total): ${u.email}\n    overview = ${JSON.stringify(t.ov)}`);
      continue;
    }
    const [{ s }] = await sql`select coalesce(sum(amount),0)::text s from ledger where user_id = ${u.id}`;
    const amount = Number((t.value - Number(s)).toFixed(8));
    if (amount < 0) {
      console.log(`  SKIP (ledger already above shown balance): ${u.email}`);
      continue;
    }
    plan.push({ ...u, path: t.path, shown: t.value, ledger: Number(s), amount });
  }

  console.log(`\n${'EMAIL'.padEnd(34)}${'SHOWN'.padStart(12)}${'LEDGER'.padStart(12)}${'OPENING'.padStart(12)}`);
  for (const p of plan) {
    console.log(`${p.email.padEnd(34)}${money(p.shown)}${money(p.ledger)}${money(p.amount)}`);
  }
  console.log(`\n${plan.length} account(s) would be converted. Total opening entries: ` +
    plan.reduce((a, p) => a + p.amount, 0).toFixed(2));

  if (!APPLY) { console.log('\nPREVIEW ONLY - nothing written.'); return; }
  if (!plan.length) return;

  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const bk = {
    snap: `backup_${ts}_user_balance_snapshots`,
    assets: `backup_${ts}_user_balance_snapshot_assets`,
    rplan: `backup_${ts}_recovery_investment_plan`,
    notes: `backup_${ts}_recovery_notes`,
  };
  await sql.unsafe(`create table ${bk.snap} as select * from user_balance_snapshots`);
  await sql.unsafe(`create table ${bk.assets} as select * from user_balance_snapshot_assets`);
  await sql.unsafe(`create table ${bk.rplan} as select * from recovery_investment_plan`);
  await sql.unsafe(`create table ${bk.notes} as select * from recovery_notes`);
  console.log(`\nBackups: ${Object.values(bk).join(', ')}`);

  const report = [];
  for (const p of plan) {
    let ledgerId = null;
    try {
      await sql.begin(async (tx) => {
        if (p.amount > 0) {
          const [row] = await tx`
            insert into ledger (user_id, account, kind, amount, ref_type, memo)
            values (${p.id}, 'main', 'adjustment', ${p.amount.toFixed(8)},
                    'recovery_conversion', ${MEMO}) returning id`;
          ledgerId = row.id;
        }
        await tx`delete from user_balance_snapshot_assets where snapshot_id in
                   (select id from user_balance_snapshots where user_id = ${p.id})`;
        await tx`delete from user_balance_snapshots where user_id = ${p.id}`;
        await tx`delete from recovery_investment_plan where user_id = ${p.id}`;
        await tx`delete from recovery_notes where user_id = ${p.id}`;
        await tx`update users set account_class = 'production', recovery_status = 'none'
                  where id = ${p.id}`;
      });

      const after = await shownTotal(p.id, p.path);
      if (Math.abs(after.value - p.shown) > TOL) {
        await undo(p, ledgerId, bk);
        console.log(`  UNDONE ${p.email}: balance would change ${p.shown} -> ${after.value}`);
        report.push({ email: p.email, status: 'undone', before: p.shown, after: after.value });
      } else {
        console.log(`  OK     ${p.email}: ${p.shown.toFixed(2)} (unchanged)`);
        report.push({ email: p.email, status: 'converted', balance: p.shown, ledgerId, opening: p.amount });
      }
    } catch (e) {
      console.log(`  FAILED ${p.email}: ${e.message}`);
      report.push({ email: p.email, status: 'failed', error: e.message });
    }
  }

  await sql`insert into settings (key, value)
            select 'one_time_tammy_convert_v1', ${JSON.stringify({ superseded: true })}
            where not exists (select 1 from settings where key = 'one_time_tammy_convert_v1')`;
  await sql`insert into settings (key, value)
            values (${'recovery_conversion_' + ts},
                    ${JSON.stringify({ at: new Date().toISOString(), backups: bk, report })})`;

  const ok = report.filter((r) => r.status === 'converted').length;
  console.log(`\nDONE: ${ok}/${plan.length} converted. Record saved in settings: recovery_conversion_${ts}`);
}

async function undo(p, ledgerId, bk) {
  await sql.begin(async (tx) => {
    if (ledgerId) await tx`delete from ledger where id = ${ledgerId}`;
    await tx.unsafe(`insert into user_balance_snapshots select * from ${bk.snap} where user_id = $1`, [p.id]);
    await tx.unsafe(`insert into user_balance_snapshot_assets select * from ${bk.assets}
                     where snapshot_id in (select id from ${bk.snap} where user_id = $1)`, [p.id]);
    await tx.unsafe(`insert into recovery_investment_plan select * from ${bk.rplan} where user_id = $1`, [p.id]);
    await tx.unsafe(`insert into recovery_notes select * from ${bk.notes} where user_id = $1`, [p.id]);
    await tx`update users set account_class = ${p.account_class}, recovery_status = ${p.recovery_status}
              where id = ${p.id}`;
  });
}

main()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => sql.end());
