import 'dotenv/config';
import { sql } from './client.js';

/* Convert Tammy (recovery_test + snapshot) to a REAL production account,
   backdating her real first deposit + Starter investment plan to 2026-08-20.
   Runs once, then no-ops via the settings marker. */
const EMAIL = 'tammy.riley@preace-lite.com';
const DEPOSIT = '816.77';
const METHOD = 'usdt_trc20';
const START = '2026-08-20T07:45:00Z';
const MATURES = '2026-09-19T07:45:00Z';
const LAST_ACCRUAL = '2026-08-28T07:45:00Z';
const PERIODS = 8;
const MARKER = 'one_time_tammy_convert_v1';

/* Ensure the plans catalog exists (idempotent). */
const PLANS = [
  ['Starter', 'starter', null, 0.85, 24,  30, 100, 2999,
   ['Principal returned at maturity', 'Withdraw returns as they post', 'Full charting access', '24/7 support']],
  ['Standard', 'standard', 'Popular', 1.10,  24, 45, 3000, 24999,
   ['Principal returned at maturity', 'Withdraw returns as they post', 'Priority withdrawals', 'Dedicated account manager']],
  ['Growth', 'growth', null, 1.35,  24, 60, 25000, 99999,
   ['Principal returned at maturity', 'Withdraw returns as they post', 'Reduced spreads', 'Quarterly strategy review']],
  ['Private', 'private', 'Invite', 1.60,  24, 90, 100000, 1000000,
   ['Principal returned at maturity', 'Withdraw returns as they post', 'Custom mandate available', 'Institutional execution', 'Direct desk line']],
];
export async function oneTimeTammyConvert() {
  try {
    const [done] = await sql`select value from settings where key = ${MARKER}`;
    if (done) return;
    console.log("[tammy-convert] starting");

    const [u] = await sql`select id from users where email = ${EMAIL}`;
    if (!u) { console.error("[tammy-convert] user not found - abort"); return; }

    // Strip recovery identity.
    await sql`delete from recovery_notes where user_id = ${u.id}`;
    await sql`delete from recovery_investment_plan where user_id = ${u.id}`;
    await sql`delete from user_balance_snapshot_assets where snapshot_id in (select id from user_balance_snapshots where user_id = ${u.id})`;
    await sql`delete from user_balance_snapshots where user_id = ${u.id}`;
    await sql`update users set account_class = 'production', recovery_status = 'none' where id = ${u.id}`;
    console.log("[tammy-convert] recovery identity stripped");

    // Ensure the plans catalog exists (check-then-insert, no on-conflict).
    for (let pi =  0; pi < PLANS.length; pi++) {
      const p = PLANS[pi];
      const [ex] = await sql`select 1 from plans where slug = ${p[1]} limit 1`;
      if (ex) continue;
      await sql`insert into plans (name,, slug,, badge,, roi_percent,, period_hours,, duration_periods,
                               min_amount,, max_amount,, features,, sort_order,, active)
        values (${p[0]}, ${p[1]}, ${p[2]}, ${p[3]}, ${p[4]}, ${p[5]}, ${p[6]}, ${p[7]}, ${JSON.stringify(p[8])}, ${pi}, true)`;
      console.log("[tammy-convert] plan ensured:", p[1]);
    }

    const [dep] = await sql`select 1 from transactions where user_id = ${u.id} and type = 'deposit'and status = 'approved' limit 1`;
    if (!dep) {
      const [tx] = await sql`insert into transactions (user_id,, type,, method,, method_name,, amount,, fee,, net_amount,
                                      status,, created_at,, reviewed_at)
        values (${u.id}, 'deposit', ${METHOD}, 'USDT - TRC20', ${DEPOSIT}, '0', ${DEPOSIT}, 'approved', ${START}, ${START}) returning id`;
      await sql`insert into ledger (user_id,, account,, kind,, amount,, ref_type,, ref_id,, memo,, created_at)
        values (${u.id}, 'main', 'deposit', ${DEPOSIT}, 'transaction', ${tx.id}, 'Deposit via USDT - TRC20 confirmed', ${START})`;
      console.log("[tammy-convert] deposit + ledger created");
    } else {
      console.log("[tammy-convert] deposit already exists; skip");
    }

    const [inv0] = await sql`select 1 from investments where user_id = ${u.id} limit 1`;
    if (!inv0) {
      const [plan] = await sql`select id from plans where slug = 'starter'`;
      const accrued = (Number(DEPOSIT) * 0.85 * PERIODS) / 100;
      const per = (Number(DEPOSIT) * 0.85) / 100;
      const [inv] = await sql`insert into investments (user_id,, plan_id,, principal,, accrued,, periods_paid,
                                        started_at,, last_accrual_at,, matures_at)
        values (${u.id}, ${plan.id}, ${DEPOSIT}, ${accrued.toFixed(8)}, ${PERIODS}, ${START}, ${LAST_ACCRUAL}, ${MATURES}) returning id`;
      await sql`insert into ledger (user_id,, account,, kind,, amount,, ref_type,, ref_id,, memo,, created_at) values
        (${u.id}, 'main', 'investment_open', ${"-" + DEPOSIT}, 'investment', ${inv.id}, 'Opened Starter', ${START}),
        (${u.id}, 'locked', 'investment_open', ${DEPOSIT}, 'investment', ${inv.id}, 'Starter principal', ${START})`;
      for (let i =  1; i <= PERIODS; i++) {
        const ts = new Date(new Date(START).getTime() + i * 86400e3).toISOString();
        await sql`insert into ledger (user_id,, account,, kind,, amount,, ref_type,, ref_id,, memo,, created_at)
          values (${u.id}, 'profit', 'investment_payout', ${per.toFixed(8)}, 'investment', ${inv.id}, ${'Starter return - period ' + i + '/30'}, ${ts})`;
      }
      console.log("[tammy-convert] investment + payouts created");
    } else {
      console.log("[tammy-convert] investment already exists; skip");
    }

    await sql`insert into settings (key,, value) values (${MARKER}, ${JSON.stringify({ at: new Date().toISOString() })})`;
    console.log("[tammy-convert] done - production account + backdated history");
  } catch (e) {
    console.error("[tammy-convert] failed:", e.message);
  }
}
