-- @contract: additive
-- Operational visibility and the improvement loop (QUINN-PRODUCT Step 11, P8).
--
-- Expand-only and replay-safe: one CREATE TABLE IF NOT EXISTS with every
-- constraint declared INLINE (a bare ALTER TABLE ... ADD CONSTRAINT errors on a
-- second run and breaks the ledger heal), CREATE [UNIQUE] INDEX IF NOT EXISTS
-- for the rest, one ADD COLUMN IF NOT EXISTS, and no backfill.
--
-- Three things land here and nothing else. The metrics, the run inspector, the
-- recovery controls and the retention pass all read rows 0287 to 0293 already
-- write; adding aggregate tables before the bounded queries are measured to be
-- expensive is the thing the specification tells this step not to do.

-- 1. Regression cases: the improvement loop's own store.
--
-- A teammate correcting an answer already creates an approved snippet. This is
-- the second half the specification asks for: the same correction can be kept
-- as a case a release candidate is checked against, so the fix is proved to
-- still hold the next time the behaviour changes.
--
-- The expectation is STRUCTURAL and closed. A case says the candidate must
-- answer, must ground that answer on a named source, or must hand off. There
-- is no free-text expected answer, because grading one needs a model and a
-- rubric that nobody has reviewed, and a check that cannot say why it failed
-- is worse than no check.
--
-- conversation_id CASCADES rather than setting null: the question is a copy of
-- something the customer wrote, so deleting their history has to take it with
-- it. A case authored from a conversation that is later deleted is gone, which
-- is the same answer the transcript gives.
CREATE TABLE IF NOT EXISTS "assistant_regression_cases" (
  "id" uuid PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  -- What was asked, as asked.
  "question" text NOT NULL,
  -- answers: a publishable answer rather than an inability or a hand-off.
  -- cites_source: that, and grounded on the recorded source.
  -- hands_off: the candidate must NOT answer this one.
  "expectation" text NOT NULL,
  "expected_source_type" text,
  "expected_source_id" text,
  -- What the teammate said the right answer was. Shown to a reviewer reading a
  -- failure; never handed to a grader, for the reason above.
  "correction_note" text,
  "enabled" boolean DEFAULT true NOT NULL,
  -- Where the case came from, so an operator can tell a curated case from one
  -- captured out of a real conversation.
  "origin" text DEFAULT 'answer_correction' NOT NULL,
  "conversation_id" uuid,
  "message_id" uuid,
  "run_id" uuid,
  "created_by_principal_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assistant_regression_cases_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
  CONSTRAINT "assistant_regression_cases_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON DELETE CASCADE,
  CONSTRAINT "assistant_regression_cases_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "assistant_runs"("id") ON DELETE SET NULL,
  CONSTRAINT "assistant_regression_cases_created_by_fkey" FOREIGN KEY ("created_by_principal_id") REFERENCES "principal"("id") ON DELETE SET NULL,
  CONSTRAINT "assistant_regression_cases_expectation_check" CHECK ("expectation" IN ('answers', 'cites_source', 'hands_off')),
  CONSTRAINT "assistant_regression_cases_origin_check" CHECK ("origin" IN ('answer_correction', 'manual')),
  CONSTRAINT "assistant_regression_cases_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 120),
  CONSTRAINT "assistant_regression_cases_question_length_check" CHECK (char_length("question") BETWEEN 1 AND 2000),
  CONSTRAINT "assistant_regression_cases_note_length_check" CHECK ("correction_note" IS NULL OR char_length("correction_note") <= 4000),
  -- A source is named exactly when the expectation is that one is cited.
  CONSTRAINT "assistant_regression_cases_source_check" CHECK (
    ("expectation" = 'cites_source' AND "expected_source_type" IS NOT NULL AND "expected_source_id" IS NOT NULL)
    OR ("expectation" <> 'cites_source' AND "expected_source_type" IS NULL AND "expected_source_id" IS NULL)
  )
);
--> statement-breakpoint
-- Adding the same corrected message twice is the same case. The unique index is
-- the guarantee; the pre-read in the command is only the fast path.
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_regression_cases_message_uidx" ON "assistant_regression_cases" ("message_id") WHERE "message_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_regression_cases_enabled_idx" ON "assistant_regression_cases" ("enabled", "created_at");
--> statement-breakpoint

-- 2. Where a guidance entry came from, when it came from a conversation.
--
-- No foreign key, for the same reason settings.assistant_published_release_id
-- carries none: a constraint added to an existing table needs an
-- ALTER TABLE ... ADD CONSTRAINT that cannot replay. The column is a backlink a
-- reader resolves, never a join anything depends on, and a conversation that is
-- deleted leaves an id that resolves to nothing, which is what the reader shows.
ALTER TABLE "assistant_guidance_entries" ADD COLUMN IF NOT EXISTS "source_conversation_id" uuid;
--> statement-breakpoint

-- 3. Indexes the operations reads need and the existing ones cannot serve.
--
-- Every run index 0287 created leads on conversation_id or on a partial
-- open-run predicate. The Improve page scans a date range across every run,
-- and the retention pass deletes by age, so both need created_at leading.
CREATE INDEX IF NOT EXISTS "assistant_runs_created_at_idx" ON "assistant_runs" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_run_steps_started_at_idx" ON "assistant_run_steps" ("started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_run_evidence_created_at_idx" ON "assistant_run_evidence" ("created_at");
