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

-- The table, and the backfill that fills it, together: on a database that
-- already has the table this whole block is skipped, so a replay never writes
-- a sender back that an admin has since cleared.
--
-- Backfill: every existing email keeps the sender it had.
--
-- - Support replies from the address the customer wrote to when the workspace
--   receives email (an inbound route, forwarded or the platform's own) and no
--   support address covers it. When the support address is the one forwarded
--   in, or the route forwards nothing, the support address is the override, so
--   a widget thread still sends from it. Otherwise support's oldest address is
--   the override.
-- - Changelog keeps its oldest address as its override.
-- - Feedback and status email always came from the platform address, and no
--   default sender existed, so neither gets a row and no default is written.
--   An admin chooses a default on Settings > Email.
-- Ticket email needs no row: it follows its conversation, else support.
-- @replay: guarded-by the email_senders table not existing yet; once it exists the table and its backfill are skipped
DO $$
BEGIN
  IF to_regclass('"email_senders"') IS NULL THEN
    CREATE TABLE "email_senders" (
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

    INSERT INTO "email_senders" ("surface", "mode", "channel_account_id")
    SELECT 'support', 'address', sa."id"
    FROM (
      SELECT ca."id", lower(ca."address") AS "address"
      FROM "channel_accounts" ca
      WHERE ca."role" = 'sending' AND ca."address" IS NOT NULL AND ca."deleted_at" IS NULL
        AND ca."module" = 'support'
      ORDER BY ca."created_at", ca."id"
      LIMIT 1
    ) sa
    WHERE NOT EXISTS (
      SELECT 1 FROM "channel_accounts" i
      WHERE i."role" = 'inbound' AND i."deleted_at" IS NULL
        AND nullif(i."config"->>'forwardingTarget', '') IS NOT NULL
        AND lower(i."config"->>'forwardingTarget') <> sa."address"
    );

    INSERT INTO "email_senders" ("surface", "mode")
    SELECT 'support', 'inbox'
    WHERE NOT EXISTS (SELECT 1 FROM "email_senders" e WHERE e."surface" = 'support')
      AND EXISTS (
        SELECT 1 FROM "channel_accounts" i
        WHERE i."role" = 'inbound' AND i."deleted_at" IS NULL
      );

    INSERT INTO "email_senders" ("surface", "channel_account_id")
    SELECT 'changelog', ca."id"
    FROM "channel_accounts" ca
    WHERE ca."role" = 'sending' AND ca."address" IS NOT NULL AND ca."deleted_at" IS NULL
      AND ca."module" = 'changelog'
    ORDER BY ca."created_at", ca."id"
    LIMIT 1;
  END IF;
END $$;

-- One sender per surface and scope. Two partial indexes rather than one, so the
-- workspace scope (scope_id null) is unique too without NULLS NOT DISTINCT.
CREATE UNIQUE INDEX IF NOT EXISTS "email_senders_surface_workspace_uq"
  ON "email_senders" ("surface", "scope_type") WHERE "scope_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "email_senders_surface_scope_uq"
  ON "email_senders" ("surface", "scope_type", "scope_id") WHERE "scope_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "email_senders_channel_account_idx"
  ON "email_senders" ("channel_account_id");
