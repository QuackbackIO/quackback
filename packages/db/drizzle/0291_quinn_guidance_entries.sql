-- @contract: additive
-- Canonical authored guidance and separately authorized role bindings
-- (QUINN-PRODUCT Step 8).
--
-- Expand-only and replay-safe: two CREATE TABLE IF NOT EXISTS with every
-- constraint declared INLINE (a bare ALTER TABLE ... ADD CONSTRAINT errors on a
-- second run and breaks the ledger heal), and CREATE INDEX IF NOT EXISTS for
-- the rest. Nothing existing is read differently and nothing is dropped.
--
-- No backfill, deliberately. The conversion of the three legacy sources
-- (assistant config writing guidelines, assistant_guidance_rules,
-- agent_skills) is lossless and has to preserve created_at ordering, per-role
-- scope and full bodies, which is more than an UPDATE can express and more
-- than a replayed statement may do twice. So it runs in code, once per
-- workspace, idempotently, on first read: see guidance-conversion.ts. The
-- unique index over (legacy_source, legacy_id) below is what makes that
-- conversion safe to race with itself, and it is the only thing this file has
-- to get right for it.

CREATE TABLE IF NOT EXISTS "assistant_guidance_entries" (
  "id" uuid PRIMARY KEY NOT NULL,
  -- always: every conversation. situational: when its condition applies.
  -- procedure: a packaged body the model loads on demand, never in the prompt.
  "kind" text NOT NULL,
  -- canonical: authored here, this table is the only store.
  -- config: a projection of the versioned assistant config, which stays the
  -- owner of the text and of the prompt block that renders it.
  "owner" text DEFAULT 'canonical' NOT NULL,
  "title" text NOT NULL,
  -- The authored instruction at full length. A converted 8,000 character
  -- procedure body lands here intact.
  "body" text NOT NULL,
  -- The situation, or a procedure's when-to-use line. Null exactly for always.
  "applies_when" text,
  "enabled" boolean DEFAULT true NOT NULL,
  -- Lower values apply first, carried over from the legacy rule ordering.
  "priority" integer DEFAULT 0 NOT NULL,
  -- Bumped by every canonical write; a save carrying an older value is refused.
  "version" integer DEFAULT 1 NOT NULL,
  -- Migration provenance: which legacy record this entry is, so the conversion
  -- is idempotent and an old reference stays explainable.
  "legacy_source" text,
  "legacy_id" text,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_guidance_entries_kind_check" CHECK ("kind" IN ('always', 'situational', 'procedure')),
  CONSTRAINT "assistant_guidance_entries_owner_check" CHECK ("owner" IN ('canonical', 'config')),
  CONSTRAINT "assistant_guidance_entries_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 80),
  -- Zero is legal: a workspace with empty writing guidelines still has the
  -- entry, exactly as the editor has always shown it.
  CONSTRAINT "assistant_guidance_entries_body_length_check" CHECK (char_length("body") <= 8000),
  CONSTRAINT "assistant_guidance_entries_applies_when_check" CHECK (
    ("kind" = 'always' AND "applies_when" IS NULL)
    OR ("kind" <> 'always' AND char_length("applies_when") BETWEEN 1 AND 1000)
  ),
  CONSTRAINT "assistant_guidance_entries_created_by_id_principal_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "principal"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
-- The conversion's own identity. One legacy record converts to exactly one
-- entry, and a second conversion pass (or a concurrent one) inserts nothing.
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_guidance_entries_legacy_uidx" ON "assistant_guidance_entries" ("legacy_source", "legacy_id") WHERE "legacy_source" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_guidance_entries_kind_idx" ON "assistant_guidance_entries" ("kind", "enabled", "priority");
--> statement-breakpoint
-- One row per profile an entry applies to. Two profiles are two rows, which is
-- what keeps a shared entry distinguishable from a single-role one and leaves
-- no place for a "both" role to be invented.
CREATE TABLE IF NOT EXISTS "assistant_guidance_bindings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "entry_id" uuid NOT NULL,
  "profile" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_guidance_bindings_profile_check" CHECK ("profile" IN ('agent', 'copilot', 'workspace')),
  CONSTRAINT "assistant_guidance_bindings_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "assistant_guidance_entries"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_guidance_bindings_entry_profile_uidx" ON "assistant_guidance_bindings" ("entry_id", "profile");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_guidance_bindings_profile_idx" ON "assistant_guidance_bindings" ("profile", "enabled");
