-- @contract: additive
-- Which address each kind of customer email is sent from, and the name it is
-- sent under.
--
-- A sending address is now an identity: `channel_accounts.address` plus a
-- `sender_name`, null meaning "use the workspace name" so a workspace rename
-- still reaches it. `email_senders` says which identity each surface sends
-- from: `default` is the workspace's default sender and `support`, `feedback`,
-- `changelog` and `status` override it. A surface with no row sends from the
-- default; no default row means the platform address.
--
-- `mode` is `address` (send as `channel_account_id`) or, for support only,
-- `inbox`: reply from the address the customer wrote to, else the default.
-- An `inbox` row names no identity, so `channel_account_id` is null on it.
--
-- The scope columns are there so per-team or per-site overrides can be added
-- later; only the workspace scope (scope_id null) is written today.
--
-- `channel_accounts.module` is no longer read for routing. It stays, unused,
-- until a later release can drop it under the contract rules.
ALTER TABLE "channel_accounts" ADD COLUMN IF NOT EXISTS "sender_name" text;

CREATE TABLE IF NOT EXISTS "email_senders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "surface" text NOT NULL,
  "scope_type" text DEFAULT 'workspace' NOT NULL,
  "scope_id" text,
  "mode" text DEFAULT 'address' NOT NULL,
  "channel_account_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- cascade: a choice of sender means nothing once its address row is gone.
  CONSTRAINT "email_senders_channel_account_id_fkey"
    FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id") ON DELETE cascade
);

-- One sender per surface and scope. Two partial indexes rather than one, so the
-- workspace scope (scope_id null) is unique too without NULLS NOT DISTINCT.
CREATE UNIQUE INDEX IF NOT EXISTS "email_senders_surface_workspace_uq"
  ON "email_senders" ("surface", "scope_type") WHERE "scope_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "email_senders_surface_scope_uq"
  ON "email_senders" ("surface", "scope_type", "scope_id") WHERE "scope_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "email_senders_channel_account_idx"
  ON "email_senders" ("channel_account_id");

-- Backfill: every existing email keeps the sender it had.
--
-- 1. A workspace that receives email (it has an inbound route, forwarded or
--    the platform's own) replies from the address the customer wrote to, as it
--    did.
-- 2. One address used everywhere becomes the workspace default.
-- 3. Otherwise each module's oldest address becomes that surface's override,
--    except support when (1) already chose the inbox.
-- 4. With several addresses and the inbox chosen, the old support address
--    becomes the default, so a reply that cannot use the inbox address (a
--    widget thread, or an unverified inbox domain) still sends from it.
-- Ticket email needs no row: it follows its conversation, else support.
--
-- Replay: every INSERT absorbs a conflict and is guarded on the rows the
-- statements before it write, so a second run inserts nothing.
INSERT INTO "email_senders" ("surface", "mode")
SELECT 'support', 'inbox'
WHERE NOT EXISTS (SELECT 1 FROM "email_senders")
  AND EXISTS (
    SELECT 1 FROM "channel_accounts" i
    WHERE i."role" = 'inbound' AND i."deleted_at" IS NULL
  )
ON CONFLICT DO NOTHING;

INSERT INTO "email_senders" ("surface", "channel_account_id")
SELECT 'default', ca."id"
FROM "channel_accounts" ca
WHERE ca."role" = 'sending' AND ca."address" IS NOT NULL AND ca."deleted_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "email_senders" e WHERE e."mode" = 'address')
  AND (
    SELECT count(DISTINCT s."address") FROM "channel_accounts" s
    WHERE s."role" = 'sending' AND s."address" IS NOT NULL AND s."deleted_at" IS NULL
  ) = 1
ORDER BY ca."created_at", ca."id"
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO "email_senders" ("surface", "channel_account_id")
SELECT DISTINCT ON (ca."module") ca."module", ca."id"
FROM "channel_accounts" ca
WHERE ca."role" = 'sending' AND ca."address" IS NOT NULL AND ca."deleted_at" IS NULL
  AND ca."module" IN ('support', 'feedback', 'changelog')
  AND NOT EXISTS (SELECT 1 FROM "email_senders" e WHERE e."mode" = 'address')
  AND (
    SELECT count(DISTINCT s."address") FROM "channel_accounts" s
    WHERE s."role" = 'sending' AND s."address" IS NOT NULL AND s."deleted_at" IS NULL
  ) > 1
ORDER BY ca."module", ca."created_at", ca."id"
ON CONFLICT DO NOTHING;

INSERT INTO "email_senders" ("surface", "channel_account_id")
SELECT 'default', ca."id"
FROM "channel_accounts" ca
WHERE ca."role" = 'sending' AND ca."address" IS NOT NULL AND ca."deleted_at" IS NULL
  AND ca."module" = 'support'
  AND EXISTS (SELECT 1 FROM "email_senders" e WHERE e."surface" = 'support' AND e."mode" = 'inbox')
  AND NOT EXISTS (SELECT 1 FROM "email_senders" e WHERE e."surface" = 'default')
ORDER BY ca."created_at", ca."id"
LIMIT 1
ON CONFLICT DO NOTHING;
