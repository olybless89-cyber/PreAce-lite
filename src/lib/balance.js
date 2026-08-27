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

    // Approx crypto equivalent in BTC, from the snapshot's own BTC price
    // when the admin recorded one, else the live mark.
    let btcPrice = snapshot.btcPrice;
    if (!(btcPrice > 0)) btcPrice = livePrices.BTCUSDT || 0;
    let btcEquiv = null;
    if (btcPrice > 0) {
      // Native BTC qty already in the snapshot
      const nativeBtc = assets.find((a) => a.asset === 'BTC')?.qty || 0;
      btcEquiv = nativeBtc + (snapshot.displayTotal - (assets.find((a) => a.asset === 'BTC')?.valueUsd || 0)) / btcPrice;
    }

    return {
      kind,
      displayTotal: snapshot.displayTotal,
      approxcBtc: btcEquiv,
      btcPrice: btcPrice > 0 ? btcPrice : null,
      assets,
      real,
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