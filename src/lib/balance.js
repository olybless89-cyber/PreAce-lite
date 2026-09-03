/* =================================================================
   BalanceService
   -----------------------------------------------------------------
   Single source of truth for what a dashboard displays as "balance".

   Three kinds, never silently mixed:

     real_balance             sum of the ledger (genuine financial history)
     recovery_display_balance snapshot rows on an account whose users
                              .account_class = 'recovery_test'
     test_balance             snapshot rows on an account NOT classified
                              as recovery_test (a code/QA account, or a
                              classifier that has not been applied yet)

   Snapshots NEVER write to the ledger and never create transactions or
   investments — they are display data belonging to the recovery console,
   not to the financial history. The ledger remains the only source of
   genuine balances.
   ================================================================= */

import { db, sql } from '../db/client.js';
import { balance } from './stats.js';

export const PRODUCTION = 'production';
export const RECOVERY_TEST = 'recovery_test';

/* Asset metadata for spot/crypto rendering. Tickers map to the same
   symbols the engine prices (BTCUSDT, ETHUSDT, …). */
const ASSET_META = {
  BTC: { name: 'Bitcoin', symbol: 'BTC', ticker: 'BTC', color: '#F7931A', pair: 'BTCUSDT', kind: 'crypto', decimals: 8 },
  ETH: { name: 'Ethereum', symbol: 'ETH', ticker: 'ETH', color: '#627EEA', pair: 'ETHUSDT', kind: 'crypto', decimals: 8 },
  USD: { name: 'US Dollar', symbol: 'USD', ticker: 'USD', color: '#2563EB', pair: null, kind: 'fiat', decimals: 2 },
  USDT: { name: 'Tether', symbol: 'USDT', ticker: 'USDT', color: '#26A17B', pair: 'USDTUSDT', kind: 'crypto', decimals: 8 },
};

export function assetMeta(asset) {
  return ASSET_META[String(asset || '').toUpperCase()] || {
    name: String(asset || 'ASSET').toUpperCase(), symbol: String(asset || 'ASSET').toUpperCase(),
    ticker: String(asset || 'ASSET').toUpperCase(), color: '#7E8FBF', pair: null, kind: 'other', decimals: 8,
  };
}

/* ---------------------------------------------------------------------
   Investment cycle hold.
   -----------------------------------------------------------------
   A user on a fixed investment plan cannot withdraw until EVERY active
   investment is mature (matures_at >= now). This applies to every
   account class — recovered/test accounts (display balance from a
   snapshot, with an admin-authored plan reference) and ordinary
   production accounts (real ledger funds locked in an active plan).

   Returns a human-ready summary used by the withdrawal page + the
   dashboard cycle card. null means withdrawals are allowed.
   ------------------------------------------------------------------- */
export async function investmentCycleHold(userId) {
  const [inv] = await sql`
    select p.name plan_name, p.slug plan_slug,
           p.roi_percent::text roi, p.period_hours,
           p.duration_periods, i.principal::text principal,
           i.matures_at
    from investments i join plans p on p.id = i.plan_id
    where i.user_id = ${userId} and i.status = 'active'
    order by i.matures_at asc
    limit 1`;
  if (!inv) return null;

  const months = Math.max(1, Math.round(Number(inv.duration_periods) * Number(inv.period_hours) / (24 * 30.44)));
  const matured = new Date(inv.matures_at).getTime() <= Date.now();

  const [recPlan] = await sql`
    select contribution_amount::text contribution_amount,
           frequency, duration_months
    from recovery_investment_plan
    where user_id = ${userId} order by id desc limit 1`;

  const [recUser] = await sql`
    select account_class::text account_class, recovery_status
    from users where id = ${userId}`;
  const isRecovery = recUser?.account_class === RECOVERY_TEST;
  const monthsLabel = recPlan?.duration_months || months;
  const freqLabel = recPlan?.frequency === 'monthly' ? 'every month'
    : recPlan?.frequency === 'weekly' ? 'every week'
    : 'every 2 weeks';

  const totalHours = Number(inv.duration_periods) * Number(inv.period_hours);
  const periodLabel = totalHours < (24 * 62) ? (Math.round(totalHours / 24) + '-day')
    : (monthsLabel + '-month');

  return {
    active: !matured,
    matured,
    planName: inv.plan_name,
    planSlug: inv.plan_slug,
    principal: Number(inv.principal),
    maturesAt: new Date(inv.matures_at),
    months: monthsLabel,
    monthsFromPlan: Number(recPlan?.duration_months || months),
    frequency: recPlan?.frequency || 'biweekly',
    frequencyLabel: freqLabel,
    contributionAmount: recPlan ? Number(recPlan.contribution_amount) : null,
    isRecovery,
    recoveryStatus: recUser?.recovery_status || 'none',
    message: isRecovery
      ? (matured
          ? `Your ${monthsLabel}-month investment cycle has completed. You can now withdraw your funds to your bank account.`
          : `Complete your ${monthsLabel}-month investment payment first — until your every-2-weeks payments complete the full investment cycleand the investment matures, withdrawals stay on hold. After the payment for the cycle is completed, you can withdraw your funds to your bank(or debit card.`)
      : `Withdrawals are locked until your ${periodLabel} investment cycle (${inv.plan_name}) matures. Once the plan completes, you can withdraw all your funds into your external bank, wallet or preferred payment method.`,
  };
}

/* Human copy for the "funds lock period" notice on the withdrawal page.
   Only rendered while the investment/recovery cycle is active (not yet matured);
   ordinary accounts without an active cycle see no lock notice.

   The actual plan/reference months drive the displayed lock length (a recovery
   or migrated account keeps its own cycle length,e.g. Tammy's 7 months);
   the site-config `withdrawalLockMonths` (passed as `fallbackMonths`) only
   serves as the default when the cycle carries no month information. */
export function lockNotice(cycle, fallbackMonths = null) {
  if (!(cycle && !cycle.matured)) return '';
  const months = cycle.monthsFromPlan || cycle.months
    || (Number(fallbackMonths) > 0 ? Number(fallbackMonths) : 7);

  return `Your funds are locked for ${months} months and cannot be withdrawn before the maturity date.`;
}

/* The latest recovery snapshot for a user, with its asset rows. */
export async function activeRecoverySnapshot(userId) {
  const [s = null] = await sql`
    select id, user_id, snapshot_type, status, display_total::text display_total,
           btc_price::text btc_price, source, notes, created_by, verified_by, verified_at, created_at, updated_at
    from user_balance_snapshots
    where user_id = ${userId}
    order by created_at desc, id desc
    limit 1`;
  if (!s) return null;

  const assets = await sql`
    select asset, asset_name, display_balance::text display_balance,
           display_quantity::text display_quantity, sort_order
    from user_balance_snapshot_assets
    where snapshot_id = ${s.id}
    order by sort_order asc, id asc`;
  const rows = assets.map((a) => ({
    asset: a.asset, name: a.asset_name, ticker: a.asset,
    valueUsd: Number(a.display_balance), qty: a.display_quantity === null || a.display_quantity === undefined
      ? null : Number(a.display_quantity),
    usdValue: Number(a.display_balance),
  }));
  return { ...s, displayTotal: Number(s.display_total), btcPrice: s.btc_price === null || s.btc_price === undefined ? null : Number(s.btc_price), assets: rows };
}

/* Does the user have a class='recovery_test' flag (or a pending classifier)? */
export async function userAccountClass(userId) {
  const [r] = await sql`select account_class::text account_class from users where id = ${userId}`;
  return r?.account_class || PRODUCTION;
}

/* ---------------------------------------------------------------------
   getBalanceOverview(user)
   Returns everything the dashboard header, assets card and market rows
   need, labelled by kind. The UI never re-derives "total" — it renders
   this object.
   ------------------------------------------------------------------- */
export async function getBalanceOverview(user) {
  const userId = user.id;
  const real = await balance(userId);
  const snapshot = await activeRecoverySnapshot(userId);
  const accountClass = await userAccountClass(userId);

  const kind = accountClass === RECOVERY_TEST
    ? 'recovery_display_balance'
    : snapshot ? 'test_balance'
    : 'real_balance';

  // Live prices for crypto assets (BTC/ETH/USDT) — optional refinement.
  let livePrices = {};
  try {
    const rows = await sql`
      select symbol, price::text price from prices
      where symbol in ('BTCUSDT','ETHUSDT')`;
    livePrices = Object.fromEntries(rows.map((r) => [r.symbol, Number(r.price)]));
  } catch { /* prices table may be empty in a fresh/staging DB */ }

  /* Recovery display path — the ONLY place a balance amount comes from a
     snapshot instead of the ledger. */
  if (snapshot) {
    const assets = snapshot.assets.map((a) => {
      const meta = assetMeta(a.asset);
      return {
        asset: a.asset, ticker: a.asset, name: meta.name,
        kind: meta.kind, color: meta.color,
        valueUsd: a.valueUsd,
        qty: a.qty,
      };
    });

    /* Real funds (admin credits, approved deposits, cycle payouts — any
       genuine ledger movement) add onto the snapshot baseline so the total
       balance always reflects both origins. The merged value is still labelled
       recovery display data and the asset row breakdown stays the certified
       snapshot (ledger funds are expressed via the snapshot total now). */
    const ledgerCredits = Math.max(0, real.total);
    const displayTotal = snapshot.displayTotal + ledgerCredits;

    // Real credited funds also appear as an explicit asset row (so the asset
    // breakdown sums to the displayed total, including the snapshot's own rows).
    if (ledgerCredits > 0) {
      assets.push({
        asset: 'USD', ticker: 'USD', name: 'Wallet cash', kind: 'fiat', color: '#2563EB',
        valueUsd: ledgerCredits, qty: ledgerCredits,
      });
    }

    // Approx crypto equivalent in BTC, from the snapshot's own BTC price
    // when the admin recorded one, else the live mark.

    let btcPrice = snapshot.btcPrice;
    if (!(btcPrice > 0)) btcPrice = livePrices.BTCUSDT || 0;
    let btcEquiv = null;
    if (btcPrice > 0) {
      // Native BTC qty already in the snapshot
      const nativeBtc = assets.find((a) => a.asset === 'BTC')?.qty || 0;
      btcEquiv = nativeBtc + (displayTotal - (assets.find((a) => a.asset === 'BTC')?.valueUsd || 0)) / btcPrice;
    }

    return {
      kind,
      displayTotal,
      approxcBtc: btcEquiv,
      btcPrice: btcPrice > 0 ? btcPrice : null,
      assets,
      real,
      ledgerCredit: ledgerCredits,
      snapshot: {
        id: snapshot.id, type: snapshot.snapshot_type, status: snapshot.status,
        source: snapshot.source, notes: snapshot.notes, createdAt: snapshot.created_at,
        verifiedAt: snapshot.verified_at, verified: snapshot.status === 'verified',
      },
      isRecovery: kind !== 'real_balance',
    };
  }

  /* Production path — total comes only from the ledger. */
  const total = real.total;
  const btcPrice = livePrices.BTCUSDT || 0;
  const assets = [];
  const owned = { BTC: 0, ETH: 0 };

  // Spot positions valued at live marks.
  const spots = await sql`
    select s.symbol, s.qty::text qty, coalesce(p.price, s.entry_price)::text mark
    from spot_positions s
    left join prices p on p.symbol = s.symbol
    where s.user_id = ${userId} and s.status = 'open'`;
  for (const sp of spots) {
    const ticker = String(sp.symbol).replace(/USDT$/, '');
    const meta = assetMeta(ticker);
    const mark = Number(sp.mark), qty = Number(sp.qty);
    assets.push({ asset: ticker, ticker, name: meta.name, kind: meta.kind, color: meta.color, valueUsd: mark * qty, qty });
    if (ticker === 'BTC') owned.BTC += qty;
    if (ticker === 'ETH') owned.ETH += qty;
  }

  // Stablecoin assets held in the ledger buckets (USD-value).
  const usdBuckets = ['main', 'profit', 'bonus', 'ref_bonus'];
  let usdValue = 0;
  for (const bucket of usdBuckets) usdValue += real[bucket] || 0;
  assets.push({ asset: 'USD', ticker: 'USD', name: 'US Dollar', kind: 'fiat', color: '#2563EB', valueUsd: usdValue, qty: usdValue });

  const btcEquiv = btcPrice > 0 ? total / btcPrice : null;

  return {
    kind, displayTotal: total, approxcBtc: btcEquiv, btcPrice: btcPrice || null,
    assets,
    real,
    snapshot: null,
    isRecovery: false,
  };
}