-- db/migrations/2026_create_roi_rate_changes.sql
--
-- Audit log of every ROI rate change (default rate changes AND per-investment
-- overrides). Keep this even after launch — it's your record of who set what
-- rate for which client, when, and why, in case a client, a new team member,
-- or a regulator ever asks. investment_id is null for default-rate changes.

create table if not exists roi_rate_changes (
  id                serial primary key,
  investment_id     integer references investments(id), -- null = platform default rate change
  old_rate_percent  numeric(6,3),
  new_rate_percent  numeric(6,3),
  changed_by        integer not null references users(id),
  reason            text,
  changed_at        timestamptz not null default now()
);

create index if not exists roi_rate_changes_investment_id_idx on roi_rate_changes (investment_id);
