-- db/migrations/2026_create_platform_settings.sql
--
-- A tiny key/value settings table. Used here for the platform-wide default
-- daily ROI rate — the rate applied to any investment that doesn't have a
-- custom negotiated rate set on it.

create table if not exists platform_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  integer references users(id)
);

-- Seed a starting default rate. 1.00 = 1.00% per day — change this to
-- whatever your actual default should be before/after running this.
insert into platform_settings (key, value)
values ('default_daily_roi_percent', '1.00')
on conflict (key) do nothing;
