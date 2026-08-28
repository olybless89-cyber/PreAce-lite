import 'dotenv/config';
import { sql } from './client.js';

/* One-time admin credential reset — boots with the app and applies once. */
const EMAIL = 'admin@preace-lite.com';
const HASH = '$argon2id$v=19$m=19456,p=1,t=2$f1MYNE2P96N7fyXaun6uYw$+CzQRE6ZGYU3jXuIhEOD2B/mS7KIoHZ/66RqI6gc9Dw';
const MARKER = 'one_time_admin_reset_v1';

export async function oneTimeAdminReset() {
  try {
    const [done] = await sql`select value from settings where key = ${MARKER}`;
    if (done) return;
    await sql`
      insert into users (email, password_hash, first_name, last_name, role, referral_code)
      values (${EMAIL}, ${HASH}, 'Platform', 'Admin', 'admin', 'ADMINRESET')
      on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', status = 'active'`;
    await sql`insert into settings (key, value) values (${MARKER}, ${new Date().toISOString()})`;
    console.log('[one-time-admin-reset] admin password reset complete');
  } catch (e) {
    console.error('[one-time-admin-reset] failed:', e.message);
  }
}