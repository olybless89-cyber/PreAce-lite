-- db/migrations/2026_add_roi_rate_to_investments.sql
--
-- Adds a per-investment ROI override to your existing `investments` table.
-- Adjust the table name if yours is called something else (e.g. `deposits`,
-- `investment_plans`) — check your schema / earlier migrations for the
-- real name before running this.
--
-- roi_rate_percent = null means "use the platform default rate"
-- (see 2026_create_platform_settings.sql). A non-null value is the
-- negotiated custom rate for that specific investment.

alter table investments
  add column if not exists roi_rate_percent numeric(6,3),
  add column if not exists roi_rate_updated_at timestamptz,
  add column if not exists roi_rate_updated_by integer references users(id);
