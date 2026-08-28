import 'dotenv/config';
import { sql } from './client.js';
import { hash } from '../lib/auth.js';

/* One-time restore of the demo recovery account (Tammy Riley) on the live DB.
   Mirrors src/db/recover-tammy.js so the snapshot/plan/trail rows are all present;
   the password is pinned here (server-side only, never committed elsewhere). */
const EMAIL = 'tammy.riley@preace-lite.com';
const PW = "%<m}~q'cicpO/f@4";
const USD_TOTAL = '2048.00';
const ASSETS = [
  { asset: 'BTC', name: 'Bitcoin', balance: '1365.80', qty: '0.021624', sort: 1 },
  { asset: 'ETH', name: 'Ethereum', balance: '482.20', qty: '0.190196', sort: 2 },
  { asset: 'USD', name: 'US Dollar', balance: '200.00', qty: null, sort: 3 },
];
const MARKER = 'one_time_tammy_restore_v1';

export async function oneTimeTammyRestore() {
  try {
    const [done] = await sql`select value from settings where key = ${MARKER}`;
    if (done) return;
    console.log('[recover-tammy] starting');

    // 1) Find or create the user. No deletion of any kind.
    let [user] = await sql`select id from users where email = ${EMAIL}`;
    if (!user) {
      [user] = await sql`
        insert into users (email, password_hash, first_name, last_name, country, role, status, referral_code)
        values (${EMAIL}, ${await hash(PW)}, 'Tammy', 'Riley', 'United States', 'user', 'active', 'TAMMYRILEY')
        returning id, email`;
      console.log(`[recover-tammy] created user ${user.id} (${PW})`);
    } else {
      console.log(`[recover-tammy] user already exists: id ${user.id}`);
    }

    // 2) Classify as recovery_test — this is the ACCOUNT_STATUS switch.
    await sql`update users set account_class = 'recovery_test', recovery_status = 'pending' where id = ${user.id}`;
    console.log('[recover-tammy] account_class = recovery_test, recovery_status = pending');

    // 3) Create the recovery snapshot if one is not already authoritative.
    const [existing] = await sql`
      select id, display_total::text from user_balance_snapshots
      where user_id = ${user.id} order by created_at desc limit 1`;
    if (existing && Number(existing.display_total) === Number(USD_TOTAL)) {
      console.log(`[recover-tammy] snapshot #${existing.id} already present at $${USD_TOTAL} — leaving untouched`);
    } else {
      const [s] = await sql`
        insert into user_balance_snapshots
          (user_id, snapshot_type, status, display_total, btc_price, source, notes, created_by)
        values (${user.id}, 'recovery', 'draft', ${USD_TOTAL}, '63140.00', 'admin_recovery',
                'Recovery snapshot — display data only, no ledger entries. BTC $1,365.80 @ 0.021624, ETH $482.20 @ 0.190196, USD $200.00.', 0)
        returning id`;
      for (const a of ASSETS) {
        await sql`
          insert into user_balance_snapshot_assets
            (snapshot_id, asset, asset_name, display_balance, display_quantity, sort_order)
          values (${s.id}, ${a.asset}, ${a.name}, ${a.balance}, ${a.qty}, ${a.sort})`;
      }
      console.log(`[recover-tammy] snapshot #${s.id} created — total $${USD_TOTAL}`);
    }

    // 4) Intended plan configuration (a recovery reference, not a payment).
    const [plan] = await sql`
      select id from recovery_investment_plan where user_id = ${user.id} order by id desc limit 1`;
    if (plan) {
      console.log(`[recover-tammy] plan configuration already on record (id ${plan.id}) — leaving untouched`);
    } else {
      await sql`
        insert into recovery_investment_plan
          (user_id, contribution_amount, frequency, duration_months, status, source, notes, created_by)
        values (${user.id}, '750.00', 'biweekly', 6, 'recovery_reference', 'admin_recovery',
                'Intended plan for recovered account. RECOVERY REFERENCE ONLY — no contributions were recorded.', 0)`;
      console.log('[recover-tammy] plan configuration recorded: $750 biweekly / 6 months (recovery_reference)');
    }

    // 5) Recovery notes trail.
    const [n] = await sql`
      select id from recovery_notes where user_id = ${user.id} and kind = 'classify' limit 1`;
    if (!n) {
      await sql`
        insert into recovery_notes (user_id, kind, body, created_by)
        values (${user.id}, 'classify',
                'Account restored as RECOVERY_TEST. Displays are recovery snapshot data; no ledger history exists for this account.', 0)`;
      console.log('[recover-tammy] classification note recorded');
    }

    // 6) Summary — verifies the exact recovery figures.
    const [top] = await sql`
      select id from user_balance_snapshots
      where user_id = ${user.id} order by created_at desc, id desc limit 1`;
    const [sum] = await sql`
      select coalesce(sum(display_balance),0)::text asset_sum
      from user_balance_snapshot_assets where snapshot_id = ${top.id}`;
    const [check] = await sql`
      select
        (select display_total::text from user_balance_snapshots
         where user_id = ${user.id} order by created_at desc limit 1) display_total,
        (select count(*)::int from ledger where user_id = ${user.id}) ledger_rows,
        (select count(*)::int from transactions where user_id = ${user.id}) tx_rows,
        (select account_class from users where id = ${user.id}) account_class,
        (select count(*)::int from investments where user_id = ${user.id}) inv_rows`;
    check.asset_sum = sum.asset_sum;
    console.log('------------------------------------------------------------');
    console.log('[recover-tammy] RESULT:', JSON.stringify(check, null, 2));
    console.log(`[recover-tammy] display total derived from assets: $${check.asset_sum} (target $${USD_TOTAL})`);
    console.log(`[recover-tammy] ledger rows: ${check.ledger_rows}, transactions: ${check.tx_rows}, investments: ${check.inv_rows} (expect 0/0/0 — no fabricated history)`);
    if (check.account_class !== 'recovery_test') throw new Error('classification failed');
    console.log('[recover-tammy] done');
    await sql`insert into settings (key, value) values (${MARKER}, ${new Date().toISOString()})`;
    console.log('[one-time-tammy] restore complete');
  } catch (e) {
    console.error('[one-time-tammy] failed:', e.message);
  }
}
