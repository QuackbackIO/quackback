-- @contract: additive
-- Replayable tool receipts and durable approvals (QUINN-PRODUCT P3).
--
-- Expand-only and replay-safe: every statement is ADD COLUMN IF NOT EXISTS or
-- CREATE INDEX IF NOT EXISTS, so a second run against a database that already
-- carries the effect changes nothing. Foreign keys are declared inline on the
-- column, with their names spelled out, because a bare ADD CONSTRAINT errors on
-- a second run and an unnamed inline reference would get a Postgres-generated
-- name the schema drift check does not expect.
--
-- No status vocabulary moves here. Both tables carry a CHECK listing their
-- statuses, and widening one would need a DROP/ADD constraint pair that is not
-- replay-safe, so the new lifecycle rides its own columns instead:
-- `outcome_status` and `reconciliation_state` on the receipt, `execution_state`
-- and `disposition` on the proposal. The old `status` column keeps its exact
-- meaning, which is also what stops an unknown outcome from ever being counted
-- as a success by a reader that predates this migration.

-- The durable run and step a receipt belongs to, so a tool effect can be
-- explained after the turn that caused it is long finished.
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "run_id" uuid CONSTRAINT "assistant_tool_calls_run_id_assistant_runs_id_fk" REFERENCES "assistant_runs"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "run_step_key" text;
--> statement-breakpoint
-- The stable logical identity of the business action, independent of the
-- model's tool-call id, the job id and the turn's customer message. A run
-- continuation or a retry recomputes the same value and therefore finds the
-- existing receipt instead of dispatching a second effect.
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "action_key" text;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "args_digest" text;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "schema_digest" text;
--> statement-breakpoint
-- The bounded normalized result a duplicate call is answered with, and whatever
-- the provider itself said about the effect.
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "result" jsonb;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "provider_receipt" jsonb;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "provider_idempotency_key" text;
--> statement-breakpoint
-- The intent was committed and the effect was attempted. A row with this set
-- and no settled_at is the crash-after-effect case: unknown, never retried.
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "dispatched_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "settled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "outcome_status" text;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "retryable" boolean;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "reconciliation_state" text;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "reconciliation_note" text;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "reconciled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "reconciled_by_id" uuid CONSTRAINT "assistant_tool_calls_reconciled_by_id_principal_id_fk" REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- How a duplicate or interrupted call of this tool may be recovered.
ALTER TABLE "assistant_tool_calls" ADD COLUMN IF NOT EXISTS "replay_strategy" text;
--> statement-breakpoint
-- Partial and unique: the claim insert conflicts on this as well as on the
-- per-turn idempotency key, so two workers that computed the same logical
-- action cannot both execute it. Two NULLs never conflict.
-- Built concurrently after the lineage transaction; see schema-ops.ts.
--> statement-breakpoint
-- Drives the reconciliation queue: the effects nobody can confirm yet.
-- Built concurrently after the lineage transaction; see schema-ops.ts.
--> statement-breakpoint
-- The run that parked on this proposal, and the step it parked at.
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "run_id" uuid CONSTRAINT "assistant_pending_actions_run_id_assistant_runs_id_fk" REFERENCES "assistant_runs"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "run_step_key" text;
--> statement-breakpoint
-- Who the action is being taken for. A review task shows the requester; it is
-- never the approver, and approval never lends the approver's own authority.
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "requested_by_id" uuid CONSTRAINT "assistant_pending_actions_requested_by_id_principal_id_fk" REFERENCES "principal"("id") ON DELETE set null;
--> statement-breakpoint
-- The same logical action identity the receipt carries, plus the exact
-- operation a reviewer approved: arguments and input contract, digested at
-- proposal time and again at the decision. Execution compares both before it
-- dispatches, so a changed argument or a changed contract needs a new decision.
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "action_key" text;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "args_digest" text;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "contract_digest" text;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "approved_args_digest" text;
--> statement-breakpoint
-- Execution is its own dimension, distinct from the review decision: an
-- approved action is queued, not completed.
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "execution_state" text;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "execution_job_id" text;
--> statement-breakpoint
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "execution_error" text;
--> statement-breakpoint
-- Why a proposal stopped being decidable without anybody deciding it. The
-- status column cannot carry a new value without a CHECK rewrite, so a
-- superseded proposal is expired with `superseded:<reason>` recorded here.
ALTER TABLE "assistant_pending_actions" ADD COLUMN IF NOT EXISTS "disposition" text;
--> statement-breakpoint
-- Drives the recovery sweep over actions whose execution is still owed.
-- Built concurrently after the lineage transaction; see schema-ops.ts.
