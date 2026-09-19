-- @contract: additive
-- Quinn releases: draft, published and rollback records over the immutable
-- effective snapshots 0287 added (QUINN-PRODUCT Step 10, P7).
--
-- A release references frozen, content-hashed snapshot content rather than the
-- newest retained versions of a history table, because a release has to stay
-- readable after any such history is pruned.
--
-- Expand-only and replay-safe: two CREATE TABLE IF NOT EXISTS with every
-- constraint declared INLINE (a bare ALTER TABLE ... ADD CONSTRAINT errors on a
-- second run and breaks the ledger heal), CREATE [UNIQUE] INDEX IF NOT EXISTS
-- for the rest, and two ADD COLUMN IF NOT EXISTS on settings. No backfill: the
-- opt-in itself publishes the workspace's current behaviour as its first
-- release, in code, under a transaction, which is not something a replayed
-- statement may do twice.
--
-- Foreign keys are named explicitly. Drizzle's derived name for
-- assistant_releases.snapshot_id -> assistant_effective_snapshots.id is longer
-- than PostgreSQL's 63-character identifier limit and comes back truncated,
-- which the drift check reads as drift.
--
-- settings.assistant_published_release_id carries NO foreign key on purpose:
-- assistant_releases references principal in the same module as settings, and
-- a constraint back the other way closes a cycle. Publication moves the
-- pointer and the release row's status in one transaction instead.
--
-- The check-status CHECK lists all six verdicts although the shipped runner
-- produces four. Widening a CHECK later needs a DROP/ADD pair that cannot
-- replay, so the vocabulary is complete from the start.

CREATE TABLE IF NOT EXISTS "assistant_releases" (
  "id" uuid PRIMARY KEY NOT NULL,
  -- Allocated at publication, not at draft creation, so a rollback published
  -- while a draft is open cannot end up numbered below it. NULL is "not
  -- published yet"; a btree unique index does not collide on NULLs.
  "release_number" integer,
  "status" text DEFAULT 'draft' NOT NULL,
  "origin" text DEFAULT 'save' NOT NULL,
  "snapshot_id" uuid NOT NULL,
  -- The snapshot's content hash, copied here so a check result binds to the
  -- exact candidate without a join.
  "candidate_hash" text NOT NULL,
  -- settings.assistant_config_revision the candidate was derived from. The
  -- publication path compares it under the settings row lock, so a save that
  -- lands between the review and the write cannot be published unreviewed.
  "config_revision" integer DEFAULT 0 NOT NULL,
  "note" text,
  -- Affected-use summary of the diff against the release this one replaces.
  "scope" jsonb,
  -- History pointers within this table; no foreign key, a release is never
  -- deleted.
  "previous_release_id" uuid,
  "restored_from_id" uuid,
  "created_by_principal_id" uuid,
  "published_by_principal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  CONSTRAINT "assistant_releases_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "assistant_effective_snapshots"("id"),
  CONSTRAINT "assistant_releases_created_by_fkey" FOREIGN KEY ("created_by_principal_id") REFERENCES "principal"("id") ON DELETE SET NULL,
  CONSTRAINT "assistant_releases_published_by_fkey" FOREIGN KEY ("published_by_principal_id") REFERENCES "principal"("id") ON DELETE SET NULL,
  CONSTRAINT "assistant_releases_status_check" CHECK ("status" IN ('draft', 'published', 'superseded')),
  CONSTRAINT "assistant_releases_origin_check" CHECK ("origin" IN ('save', 'rollback'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_releases_number_uidx" ON "assistant_releases" ("release_number");
--> statement-breakpoint
-- One draft and one live release, enforced in PostgreSQL rather than by a
-- read-then-write two publishers could both pass.
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_releases_one_draft_uidx" ON "assistant_releases" ("status") WHERE "status" = 'draft';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_releases_one_published_uidx" ON "assistant_releases" ("status") WHERE "status" = 'published';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_releases_created_idx" ON "assistant_releases" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_release_checks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "release_id" uuid NOT NULL,
  -- Catalogue key. Whether the check is required is read from the catalogue,
  -- never frozen here.
  "check_key" text NOT NULL,
  "status" text NOT NULL,
  -- The candidate hash this result was produced against. A row whose hash no
  -- longer matches its release's candidate is stale evidence.
  "candidate_hash" text NOT NULL,
  "summary" text,
  "detail" jsonb,
  "ran_by_principal_id" uuid,
  "ran_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_release_checks_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "assistant_releases"("id") ON DELETE CASCADE,
  CONSTRAINT "assistant_release_checks_ran_by_fkey" FOREIGN KEY ("ran_by_principal_id") REFERENCES "principal"("id") ON DELETE SET NULL,
  CONSTRAINT "assistant_release_checks_status_check" CHECK ("status" IN ('running', 'passed', 'failed', 'skipped', 'inconclusive', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_release_checks_identity_uidx" ON "assistant_release_checks" ("release_id", "check_key");
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "assistant_release_management" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "assistant_published_release_id" uuid;
