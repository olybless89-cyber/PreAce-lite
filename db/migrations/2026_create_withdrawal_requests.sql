-- db/migrations/2026_create_withdrawal_requests.sql
--
-- Written for Postgres syntax (Railway's default managed DB). If this
-- project uses MySQL/SQLite or an ORM's migration format (Prisma, Drizzle,
-- Knex, etc.), translate this into that tool's migration instead of running
-- it directly — check your db/ or migrations/ folder for the pattern this
-- project already uses.
--
-- Adjust `references users(id)` if your users table/primary key is named
-- differently.

create table if not exists withdrawal_requests (
  id              serial primary key,
  user_id         integer not null references users(id),
  bank_code       text not null,
  account_number  text not null,
  account_name    text not null,
  status          text not null default 'pending', -- 'pending' | 'pending_locked' | 'processing' | 'completed' | 'rejected'
  unlock_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists withdrawal_requests_user_id_idx on withdrawal_requests (user_id);
create index if not exists withdrawal_requests_status_idx on withdrawal_requests (status);
