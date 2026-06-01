-- Richer conversation lifecycle: a 'pending' status (waiting on the customer)
-- and a resolved_at timestamp. 'pending' needs no DDL — status is stored as
-- text (the enum is a TypeScript-only Drizzle constraint, not a PG enum), so
-- only the additive resolved_at column is required. Existing rows get NULL,
-- which is correct (they predate the resolved concept).

ALTER TABLE "conversations" ADD COLUMN "resolved_at" timestamptz;
