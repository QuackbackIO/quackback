-- Quinn Phase 5: custom-action library (QUINN-TWO-AGENT-SPEC D6). One shared
-- table of action DEFINITIONS (name, when-to-use routing text, an HTTP request
-- template, model-filled variables, and a response-field allowlist that scopes
-- which parts of the response reach the model). Assignment is per agent (a
-- boolean each in `assignments`), no run-mode dial (D14). Secret header values
-- are encrypted at rest by the service before insert; the stored value on a
-- secret header is ciphertext.
--
-- Registration is gated by the new `assistantCustomActions` feature flag
-- (default off, read-time spread — no per-flag migration needed): enabled +
-- assigned + flag-on together decide whether a definition assembles into an
-- agent's toolset at turn time.
-- TypeIDs are stored as native `uuid` (prefixes are a code-only concern), so
-- the pk and the principal FK are uuid columns, matching every other table.
CREATE TABLE IF NOT EXISTS "assistant_actions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "when_to_use" text NOT NULL,
  "method" text NOT NULL,
  "url" text NOT NULL,
  "headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "body" text,
  "variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "response_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "response_char_limit" integer DEFAULT 4000 NOT NULL,
  "assignments" jsonb DEFAULT '{"agent":false,"copilot":false}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_actions_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 80),
  CONSTRAINT "assistant_actions_when_to_use_length_check" CHECK (char_length("when_to_use") BETWEEN 1 AND 500),
  CONSTRAINT "assistant_actions_method_check" CHECK ("method" IN ('GET', 'POST')),
  CONSTRAINT "assistant_actions_response_char_limit_check" CHECK ("response_char_limit" BETWEEN 100 AND 20000)
);
--> statement-breakpoint
-- IF NOT EXISTS discipline (matches the CREATE TABLE / CREATE INDEX siblings):
-- ADD CONSTRAINT has no native IF NOT EXISTS, so guard it so a re-run is a
-- no-op instead of erroring on the already-present FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assistant_actions_created_by_id_principal_id_fk'
  ) THEN
    ALTER TABLE "assistant_actions"
      ADD CONSTRAINT "assistant_actions_created_by_id_principal_id_fk"
      FOREIGN KEY ("created_by_id") REFERENCES "public"."principal"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_actions_enabled_idx" ON "assistant_actions" USING btree ("enabled");
--> statement-breakpoint
-- Case-insensitive uniqueness on the definition name. Backstops the service's
-- slug-collision check so the `action_<slug>` tool name a pending proposal
-- persists stays a stable 1:1 key — two names that fold to the same value can
-- never both exist and remap that tool name to a different surviving action.
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_actions_name_lower_unique" ON "assistant_actions" USING btree (lower("name"));
