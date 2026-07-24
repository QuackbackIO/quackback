-- Remove the 'web_form' channel entirely. The conversations.channel enum is
-- TS-only (plain text column), so this is a pure data migration: ticket-intake
-- backing conversations now mint as channel 'messenger' / source 'ticket_form'
-- (ticket-intake.service.ts), and existing 'web_form' rows are rewritten to
-- that same shape. Stored workflow definitions that scope a trigger or a
-- condition to the 'web_form' channel are rewritten to 'messenger' so they
-- keep firing on those conversations (channelAllows treats a channel string
-- match literally; without this rewrite, web_form-scoped workflows would
-- silently stop firing).
--
-- Idempotent by construction: each statement's target set is gated on the
-- literal 'web_form' still being present, so a second run is a no-op.
-- Ticket #499's mis-linked pair is deliberately NOT remediated here (no safe
-- way to identify the original messenger conversation in SQL) — that is a
-- manual follow-up.

-- Step 1: rewrite the conversations themselves. Intake historically wrote
-- channel + source 'web_form' together; the OR covers any row that picked up
-- only one of the two.
UPDATE "conversations"
SET "channel" = 'messenger', "source" = 'ticket_form'
WHERE "channel" = 'web_form' OR "source" = 'web_form';
--> statement-breakpoint

-- Step 2: rewrite stored workflow definitions. 'web_form' appears only as a
-- channel string literal — in trigger_settings.channels arrays and inside
-- graph condition nodes ({field: 'conversation.channel', op, value}) — so a
-- JSON string-literal replace on the serialized jsonb is exact. Both the live
-- definitions and saved versions (a rollback must not resurrect 'web_form')
-- are rewritten.
UPDATE "workflows"
SET "trigger_settings" = replace("trigger_settings"::text, '"web_form"', '"messenger"')::jsonb,
    "graph" = replace("graph"::text, '"web_form"', '"messenger"')::jsonb
WHERE "trigger_settings"::text LIKE '%"web_form"%'
   OR "graph"::text LIKE '%"web_form"%';
--> statement-breakpoint

UPDATE "workflow_versions"
SET "trigger_settings" = replace("trigger_settings"::text, '"web_form"', '"messenger"')::jsonb,
    "graph" = replace("graph"::text, '"web_form"', '"messenger"')::jsonb
WHERE "trigger_settings"::text LIKE '%"web_form"%'
   OR "graph"::text LIKE '%"web_form"%';
