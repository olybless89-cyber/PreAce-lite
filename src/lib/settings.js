import { eq } from 'drizzle-orm';
import { db, sql } from '../db/client.js';
import { settings as settingsT, paymentMethods } from '../db/schema.js';

/* Key-value store backed by the `settings` table. Each value is a jsonb
   column, so structured values (objects, arrays) survive a round trip
   without serialization on the caller's side. */

export async function getSetting(key, fallback = null) {
  const [row] = await db.select().from(settingsT).where(eq(settingsT.key, key)).limit(1);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.insert(settingsT).values({ key, value })
    .onConflictDoUpdate({ target: settingsT.key, set: { value } });
  return value;
}

/* Wallet addresses are stored as one object keyed by payment method:
     { usdt_trc20: 'TQn9...', btc: 'bc1q...', eth: '0x...', bank: 'IBAN...' }
   The deposit view reads this to show the user where to send funds. */
const DEFAULT_WALLETS = {
  usdt_trc20: '',
  btc: '',
  eth: '',
  bank: '',
};

export async function getWallets() {
  const stored = await getSetting('wallet_addresses', {});
  return { ...DEFAULT_WALLETS, ...stored };
}

export async function setWallets(obj) {
  const clean = { ...DEFAULT_WALLETS };
  for (const k of Object.keys(DEFAULT_WALLETS)) {
    if (typeof obj[k] === 'string') clean[k] = obj[k].trim();
  }
  await setSetting('wallet_addresses', clean);
  return clean;
}

/* Site-wide knobs editable from the admin UI (System → Site settings):
   supportEmail — inbox for contact-form mail; shown to users as the
     support address. Defaults to SUPPORT_EMAIL env, else the shared Gmail.
   smartsuppKey — Smartsupp live-chat widget key; blank disables the widget.
     Defaults to SMARTSUPP_KEY env, else the legacy hardcoded key.
   officeAddress / officePhone — physical company details shown on the
     public contact page and site footer. Defaults to the registered office. */
const DEFAULT_SITE = {
  supportEmail: process.env.SUPPORT_EMAIL || 'preacelitesupport@gmail.com',
  smartsuppKey: process.env.SMARTSUPP_KEY || '4274d05b1ff81bb5c726ea48b1364f81eb785401',
  withdrawalKycRequired: false,   // enforce KYC approval before withdrawals
  officeAddress: '30 South 9th Street, 7th Floor, Minneapolis, MN 55402',
  officePhone: '(936) 235-1482',
  withdrawalLockMonths: 7,      // "funds lock period" notice length
  /* Bank choices shown in the withdraw "Select your bank" dropdown. */
  bankOptions: [
    'Access Bank', 'Bank of America', 'Citibank', 'Chase',
    'Fidelity Bank', 'First Bank of Nigeria', 'GTBank',
    'Kuda Bank', 'Moniepoint', 'Opay', 'Stanbic IBTC',
    'UBA', 'Wells Fargo', 'Zenith Bank',
  ],
};

let siteCache = { value: null, at: 0 };
const SITE_TTL_MS = 15_000;

/* People often paste the whole `<script>..._smartsupp.key = '...'...</script>`
   snippet instead of just the hex key. Normalize on every read so the widget
   works even after a botched paste; also un-escapes HTML entities. */
function normalizeSmartsuppKey(raw) {
  let v = String(raw || '')
    .replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const snippet = v.match(/_smartsupp\.key\s*=\s*['"]([a-f0-9]{32,})['"]/i);
  if (snippet) return snippet[1].toLowerCase();
  if (/^[a-f0-9]{32,}$/i.test(v.trim())) return v.trim().toLowerCase();
  return v.trim();
}

/* Cached read for the per-request middleware. Falls back to defaults when
   the settings table isn't readable yet (first boot before migration). */
export async function getSiteConfig() {
  const now = Date.now();
  if (siteCache.value && now - siteCache.at < SITE_TTL_MS) return siteCache.value;
  let stored = null;
  try { stored = await getSetting('site_config', null); }
  catch { /* table may not exist yet — defaults are fine */ }
  const merged = { ...DEFAULT_SITE, ...(stored || {}) };
  merged.smartsuppKey = normalizeSmartsuppKey(merged.smartsuppKey);
  siteCache = { value: merged, at: now };
  return siteCache.value;
}

export async function setSiteConfig(partial) {
  const prev = await getSiteConfig();
  const next = {
    supportEmail: String(partial.supportEmail ?? prev.supportEmail).trim() || DEFAULT_SITE.supportEmail,
    smartsuppKey: normalizeSmartsuppKey(partial.smartsuppKey ?? prev.smartsuppKey),
    withdrawalKycRequired: partial.withdrawalKycRequired !== undefined
      ? (partial.withdrawalKycRequired === true || partial.withdrawalKycRequired === 'on')
      : !!prev.withdrawalKycRequired,
    officeAddress: String(partial.officeAddress ?? prev.officeAddress).trim() || DEFAULT_SITE.officeAddress,
    officePhone: String(partial.officePhone ?? prev.officePhone ?? '').trim(),
    withdrawalLockMonths: Math.min(60, Math.max(1, Number(partial.withdrawalLockMonths ?? prev.withdrawalLockMonths ?? 7) || 7)),
    bankOptions: Array.isArray(partial.bankOptions)
      ? partial.bankOptions.map((s) => String(s).trim()).filter(Boolean).slice(0, 40)
      : prev.bankOptions || DEFAULT_SITE.bankOptions,
  };
  await setSetting('site_config', next);
  siteCache = { value: next, at: Date.now() };
  return next;
}

/* Payment methods — admin-managed list used by deposit and withdrawal
   forms. Slug is derived from the name, stable across renames of the
   display label only when edited via slug field indirectly (name change
   keeps original transactions readable because method is just a slug). */
export async function listPaymentMethods(onlyEnabled = false, forAction = null) {
  const rows = await db.select().from(paymentMethods)
    .orderBy(paymentMethods.sortOrder, paymentMethods.id);
  let out = rows;
  if (onlyEnabled) out = out.filter((r) => r.enabled && !r.archived);
  if (forAction === 'deposit') out = out.filter((r) => r.depositEnabled !== false);
  if (forAction === 'withdrawal') out = out.filter((r) => r.withdrawalEnabled !== false);
  return out;
}

export async function getPaymentMethod(slug) {
  const [m] = await db.select().from(paymentMethods).where(eq(paymentMethods.slug, slug)).limit(1);
  return m || null;
}

const CARD_DEFAULT = {
  slug: 'debit_card',
  name: 'Debit / credit card',
  type: 'card',
  instructions: '',
  withdrawalInstructions: '',
  enabled: true,
  archived: false,
  depositEnabled: false,
  withdrawalEnabled: true,
  minDeposit: '10',
  maxDeposit: null,
  minWithdrawal: '10',
  maxWithdrawal: null,
  feeFixed: '0',
  feePercent: '0',
  depositFields: [],
  withdrawalFields: [
    { name: 'cardNumber', label: 'Card number', type: 'text', required: true, placeholder: 'Card number' },
    { name: 'cardName', label: 'Name on the card', type: 'text', required: true },
    { name: 'cardExpiry', label: 'Expiry (MM/YY)', type: 'text', required: true, placeholder: 'MM/YY' },
  ],
  sortOrder: 4,
};

export async function seedDefaultPaymentMethods() {
  const existing = await db.select({ id: paymentMethods.id }).from(paymentMethods).limit(1);
  if (existing.length) {
    await reconcilePaymentMethodDefaults();
    return false;
  }
  const defaults = [
    { slug: 'usdt_trc20', name: 'USDT — TRC20', type: 'crypto', instructions: '', sortOrder: 0,
      withdrawalFields: [{ name: 'address', label: 'USDT wallet address (TRC20)', type: 'text', required: true, placeholder: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' }] },
    { slug: 'btc', name: 'Bitcoin', type: 'crypto', instructions: 'bc1qwcu7gyq8mhe75rj3vt535c7rtr6h795m5d8fch', sortOrder: 1,
      withdrawalFields: [{ name: 'address', label: 'Bitcoin wallet address', type: 'text', required: true, placeholder: 'bc1qwcu7gyq8mhe75rj3vt535c7rtr6h795m5d8fch' }] },
    { slug: 'eth', name: 'Ethereum — ERC20', type: 'crypto', instructions: '', sortOrder: 2,
      withdrawalFields: [{ name: 'address', label: 'Ethereum wallet address (ERC20)', type: 'text', required: true, placeholder: '0x71C…' }] },
    { slug: 'bank', name: 'Bank transfer', type: 'bank', instructions: '', sortOrder: 3,
      withdrawalFields: [
        { name: 'bankName', label: '🏦 Select your bank', type: 'select', required: true, placeholder: 'Choose bank…' },
        { name: 'accountNumber', label: 'Account number', type: 'text', required: true, placeholder: 'Enter account number' },
        { name: 'accountName', label: 'Account name', type: 'text', required: true, placeholder: 'Account holder name' },
      ] },
    CARD_DEFAULT,
  ];
  await db.insert(paymentMethods).values(defaults);
  // Carry over any wallet addresses saved under the old fixed scheme.
  try {
    const wallets = await getWallets();
    for (const d of defaults) {
      const addr = String(wallets[d.slug] || '').trim();
      if (addr) await db.update(paymentMethods).set({ instructions: addr }).where(eq(paymentMethods.slug, d.slug));
    }
  } catch { /* old keys may not exist — fine */ }
  return true;
}

/* On installs that already have methods (old DB), make sure the debit-card
   payout destination exists too — the withdrawal setup step offers it. If a
   database was seeded before card destinations existed, insert it now. */
async function ensureCardMethod() {
  const [card] = await db.select({ id: paymentMethods.id }).from(paymentMethods)
    .where(eq(paymentMethods.slug, CARD_DEFAULT.slug)).limit(1);
  if (!card) await db.insert(paymentMethods).values([CARD_DEFAULT]);
}

/* Reconcile the bank method's withdrawal fields when an existing install still
   has the pre-destination-first shape (bank name text + SWIFT). Admins who
   customised the bank fields keep theirs. */
async function reconcileBankWithdrawalFields() {
  const [m] = await db.select().from(paymentMethods)
    .where(eq(paymentMethods.slug, 'bank')).limit(1);
  if (!m) return;
  const old = Array.isArray(m.withdrawalFields) ? m.withdrawalFields : [];
  if (!old.some((f) => f.name === 'bankName' && f.type === 'text'))
    return;   // already the new shape (or fully custom) — leave alone
  const bank = old.find((f) => f.name === 'bankName');
  const updated = old
    .filter((f) => f.name !== 'swift')
    .map((f) => f.name === 'bankName'
      ? { ...bank, label: '🏦 Select your bank', type: 'select', placeholder: 'Choose bank…' }
      : f.name === 'accountNumber'
        ? { ...f, placeholder: 'Enter account number' }
        : f.name === 'accountName'
          ? { ...f, placeholder: 'Account holder name' }
          : f);
  await db.update(paymentMethods).set({ withdrawalFields: updated }).where(eq(paymentMethods.id, m.id));
  console.log('[settings] reconciled bank withdrawal fields to destination-first');
}

export async function reconcilePaymentMethodDefaults() {
  await ensureCardMethod().catch((e) => console.error('[settings] card method ensure failed:', e.message));
  await reconcileBankWithdrawalFields().catch((e) => console.error('[settings] bank withdrawal fields reconcile failed:', e.message));
  await backfillMethodInstructions({
    usdt_trc20: '',
    btc: 'bc1qwcu7gyq8mhe75rj3vt535c7rtr6h795m5d8fch',
    eth: '',
    bank: '',
  }).catch((e) => console.error('[settings] address backfill failed:', e.message));
}

/* Best-effort: fill in a deposit address when the method exists but has no
   deposit instructions yet (e.g. an older deployment). Never overwrites an
   address an admin has already entered. */
async function backfillMethodInstructions(map) {
  for (const [slug, addr] of Object.entries(map)) {
    if (!addr) continue;
    const [m] = await db.select().from(paymentMethods)
      .where(eq(paymentMethods.slug, slug)).limit(1);
    if (m && !String(m.instructions || '').trim() && m.depositEnabled !== false) {
      await db.update(paymentMethods).set({ instructions: addr }).where(eq(paymentMethods.id, m.id));
      console.log(`[settings] backfilled ${slug} deposit address`);
    }
  }
}

export function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'method';
}

const moneyOr = (v, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? String(n) : dflt;
};
const moneyOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? String(n) : null;
};

/* Dynamic fields arrive as a JSON string from the admin form; each entry is
   {name,label,type,required,placeholder,help}. Slugify names, cap count. */
export function parseFields(raw) {
  if (!raw) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch { return null; }   // null = invalid JSON
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, 20).map((f) => ({
    name: slugify(f.name || f.label || 'field'),
    label: String(f.label || f.name || 'Field').slice(0, 80),
    type: ['text', 'email', 'number', 'url', 'select'].includes(f.type) ? f.type : 'text',
    required: !!f.required,
    placeholder: String(f.placeholder || '').slice(0, 120),
    help: String(f.help || '').slice(0, 160),
  }));
}

export function methodValues(b) {
  const depositFields = parseFields(b.depositFields);
  const withdrawalFields = parseFields(b.withdrawalFields);
  return {
    type: ['crypto', 'card', 'bank', 'mobile', 'giftcard', 'gateway', 'manual', 'other'].includes(b.type) ? b.type : 'other',
    instructions: String(b.instructions || '').trim(),
    withdrawalInstructions: String(b.withdrawalInstructions || '').trim(),
    enabled: b.enabled === 'on' || b.enabled === true,
    depositEnabled: b.depositEnabled === 'on' || b.depositEnabled === true,
    withdrawalEnabled: b.withdrawalEnabled === 'on' || b.withdrawalEnabled === true,
    minDeposit: moneyOr(b.minDeposit, '10'),
    maxDeposit: moneyOrNull(b.maxDeposit),
    minWithdrawal: moneyOr(b.minWithdrawal, '10'),
    maxWithdrawal: moneyOrNull(b.maxWithdrawal),
    feeFixed: moneyOr(b.feeFixed, '0'),
    feePercent: moneyOr(b.feePercent, '0'),
    depositFields: depositFields === null ? undefined : depositFields,
    withdrawalFields: withdrawalFields === null ? undefined : withdrawalFields,
    sortOrder: Number(b.sortOrder) || 0,
    fieldsInvalid: depositFields === null || withdrawalFields === null,
  };
}

export async function addPaymentMethod(b) {
  const name = String(b.name || '').trim();
  const base = slugify(name);
  let slug = base;
  const taken = new Set((await db.select({ slug: paymentMethods.slug }).from(paymentMethods)).map((r) => r.slug));
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  const all = await listPaymentMethods();
  const sortOrder = all.length ? Math.max(...all.map((m) => m.sortOrder)) + 1 : 0;
  const v = methodValues(b);
  delete v.sortOrder;
  return db.insert(paymentMethods).values({ slug, name, sortOrder, ...v }).returning();
}

export async function updatePaymentMethod(id, b) {
  const v = methodValues(b);
  await db.update(paymentMethods).set({
    name: String(b.name || '').trim(),
    ...v, updatedAt: new Date(),
  }).where(eq(paymentMethods.id, Number(id)));
}

/* Hard delete only when nothing references it; otherwise archive so
   historical transactions keep their method label. */
export async function deletePaymentMethod(id) {
  const [m] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, Number(id))).limit(1);
  if (!m) return { archived: false };
  const [used] = await sql`select count(*)::int n from transactions where method = ${m.slug}`;
  if (used.n > 0) {
    await db.update(paymentMethods)
      .set({ archived: true, enabled: false, updatedAt: new Date() })
      .where(eq(paymentMethods.id, Number(id)));
    return { archived: true };
  }
  await db.delete(paymentMethods).where(eq(paymentMethods.id, Number(id)));
  return { archived: false };
}
