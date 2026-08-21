-- Dedicated home for the control plane's tenant-ownership stamp.
--
-- The stamp (SAAS-HOSTING-STACK.md §3) is the fact a pooled process checks on
-- pool checkout before it will serve a database: this database says it belongs
-- to tenant X, and the registry record says it should. Until now it lived only
-- in `settings.metadata`, a shared JSON bag — and `telemetry/instance-id.ts`
-- performs an unlocked, unattended HOURLY read-modify-write of that same bag
-- which never invalidates the settings cache. Two writers, no lock, once an
-- hour, on the one value that stands between a pooled fleet and serving the
-- wrong tenant's data.
--
-- A dedicated column removes the class rather than narrowing the window: the
-- telemetry writer touches `metadata` and cannot reach this.
--
-- Expand-only and nullable. Every existing install has NULL here, which is
-- exactly right: a self-hosted install is not claimed by any control plane, and
-- the pooled reader treats "no stamp" as a refusal to serve rather than as a
-- default. Nothing reads this column until a control plane writes it.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloud_tenant_id" text;

COMMENT ON COLUMN "settings"."cloud_tenant_id" IS
  'Control-plane tenant id claiming this database. NULL on self-hosted installs. Read on pool checkout by the pooled fleet; never rendered to a client.';
