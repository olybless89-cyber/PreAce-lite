/* =================================================================
   BOOTSTRAP A FRESH SUPABASE DATABASE FOR PREACE-LITE
   -----------------------------------------------------------------
   Runs, in order, on whatever DATABASE_URL is currently set:
     1. migrate            (src/db/migrate.js)      — idempotent schema
     2. seed               (src/db/seed.js)        — plans, traders, bots,
                                                            admin, demo client
     3. recover-tammy      (src/db/recover-tammy.js) — Tammy Riley RECOVERY_TEST
     4. verify              (inline)                 — counts + recovery figures

   Safe to run repeatedly (every step is idempotent).
   Reads ADMIN_EMAIL / ADMIN_PASSWORD (for seed) and TAMMY_PASSWORD
   from the environment (SEED falls back to secure defaults used only by the demo/seed).

   Usage:
     DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require \
     ADMIN_EMAIL=admin@yourdomain.com ADMIN_PASSWORD='Strong!Pass123' TAMMY_PASSWORD='Tammy!Recovery2026' \
     node src/db/bootstrap-supabase.js
   ================================================================= */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { sql } from './client.js';
import { migrate } from './migrate.js';

const run = (label, args) => new Promise((resolve, reject) => {
  console.log(`\n==> ${label}`);
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${label} failed (exit ${code ?? signal})`));
  });
});

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[bootstrap] Set DATABASE_URL first (e.g. the Supabase session-pooler string).');
    process.exit(2);
  }

  console.log(`[bootstrap] DATABASE_URL target: ${process.env.DATABASE_URL.replace(/:([^:@/]+)@/, ':***@')}`);

  // 1) Schema (uses the same export the app's boot migration calls)
  await migrate();

  // 2) Seed content — plans, traders, bots, admin, demo client with a
  //    real funded ledger/investment history (idempotent; skips existing)
  await run('[bootstrap] seed', ['src/db/seed.js']);

  // 3) Tammy Riley RECOVERY_TEST classification + snapshot + plan ref.
  await run('[bootstrap] recover-tammy', ['src/db/recover-tammy.js']);

  // 4) Verify — counts and the exact recovery figures.

  const u = await sql`
    select u.id, u.email, u.account_class, u.recovery_status,
           r.snapshot_id, r.display_total, r.assets, r.ledger_rows, r.tx_rows
    from users u
    left join lateral (
      select s.id snapshot_id, s.display_total::numeric(20,8) display_total,
             coalesce((select sum(a.display_balance) from user_balance_snapshot_assets a where a.snapshot_id = s.id),0)::numeric(20,8) assets,
             (select count(*)::int from ledger l where l.user_id = u.id) ledger_rows,
             (select count(*)::int from transactions t where t.user_id = u.id) tx_rows
      from user_balance_snapshots s
      where s.user_id = u.id order by s.created_at desc, s.id desc limit 1
    ) r on true
    where u.email in ('admin@preace-lite.com', ${process.env.ADMIN_EMAIL || 'admin@preace-lite.com'}, 'demo@preace-lite.com', 'tammy.riley@preace-lite.com')
    order by u.id`;
  console.log('\n------------------------------------------------------------');
  console.log('[bootstrap] VERIFY');
  for (const row of u) {
    console.log(`  ${row.email.padEnd(30)} class=${String(row.account_class).padEnd(13)}${row.snapshot_id ? ` snapshot#${row.snapshot_id} $${row.display_total} assets=$${row.assets} ledger=${row.ledger_rows} txn=${row.tx_rows}` : ''}`);
  }

  const [{ total_users }] = await sql`
    select count(*)::int total_users from users`;
  const [{ plans }] = await sql`select count(*)::int plans from plans`;
  const [{ traders }] = await sql`select count(*)::int traders from traders`;
  const [{ bots }] = await sql`select count(*)::int bots from bots`;
  console.log(`  totals: users=${total_users}, plans=${plans}, traders=${traders}, bots=${bots}`);
  console.log('------------------------------------------------------------');
  console.log('[bootstrap] done. The site should now be fully usable in production.');
  await sql.end();
}

main().catch((e) => { console.error('[bootstrap] failed:', e); process.exit(1); });