-- db/migrations/2026_add_roi_period_fields.sql
--
-- Extends the ROI system (from the earlier roi-admin-update bundle) to
-- support a rate PERIOD (daily/weekly/monthly/yearly), an effective date,
-- and a reference field for the signed agreement — not just a flat daily %.
--
-- Safe to run even if you never ran the earlier bundle's migrations —
-- these use IF NOT EXISTS / CREATE TABLE IF NOT EXISTS throughout, so
-- running this on a fresh investments table (without roi_rate_percent yet)
-- will add everything needed in one pass.

alter table investments
  add column if not exists roi_rate_percent numeric(6,3),
  add column if not exists roi_rate_period varchar(10),      -- 'daily' | 'weekly' | 'monthly' | 'yearly'
  add column if not exists roi_effective_date date,           -- when this rate starts applying
  add column if not exists roi_reference text,                -- e.g. "Signed agreement ref #123, 2026-09-08"
  add column if not exists roi_rate_updated_at timestamptz,
  add column if not exists roi_rate_updated_by integer references users(id);

-- Audit log — if you already ran the earlier bundle's
-- 2026_create_roi_rate_changes.sql, this just adds the new `period` column.
-- If not, this creates the table fresh.
create table if not exists roi_rate_changes (
  id                serial primary key,
  investment_id     integer references investments(id),
  old_rate_percent  numeric(6,3),
  new_rate_percent  numeric(6,3),
  old_period        varchar(10),
  new_period        varchar(10),
  effective_date    date,
  reference         text,
  changed_by        integer not null references users(id),
  reason            text,
  changed_at        timestamptz not null default now()
);

alter table roi_rate_changes
  add column if not exists old_period varchar(10),
  add column if not exists new_period varchar(10),
  add column if not exists effective_date date,
  add column if not exists reference text;

create index if not exists roi_rate_changes_investment_id_idx on roi_rate_changes (investment_id);
