-- Convergence Phase 6 — literal convergence (scratchpad/convergence-design.md;
-- flips open decision #1 from union-forever to MIGRATE). The user decision:
-- tickets must NOT contain user messages. Pre-convergence legacy
-- customer-visible messages still parented to tickets move to the pair's
-- conversation, and standalone pre-1b customer tickets (filed before backing
-- conversations existed at intake) get one backfilled. After this migration,
-- `conversation_messages.ticket_id` on a CUSTOMER ticket means exactly one
-- thing: an internal note (team-only) — plus the one designed exception below.
--
-- SIDE-EFFECT-FREE BY CONSTRUCTION: pure SQL parent swaps + row inserts. No
-- app write pipeline runs, so no message.created replay, no notification
-- fan-out, no watermark/lastMessageAt recomputation beyond the backfilled
-- rows' own columns, no SLA settle/re-arm (there are no triggers on any of
-- these tables). Read-neutral: the pair-thread union loader merges both
-- parents on (created_at, id), so moving a row from the ticket parent to the
-- conversation parent of the SAME pair changes nothing the loader returns
-- (pinned byte-identical by migration-0218-*.test.ts). Idempotent: step 1's
-- rows no longer match once ticket_id is NULL, and step 2's candidate set is
-- gated on the link NOT EXISTING — a second run re-parents 0 and backfills 0.
--
-- THE DESIGNED EXCEPTION: a standalone customer ticket with NO requester
-- (requester_principal_id IS NULL — e.g. the requester principal was deleted,
-- the FK is `set null`) gets no backing conversation (a conversation requires
-- a visitor). Its legacy rows stay ticket-parented and keep reading through
-- the union loader forever, exactly as they did pre-migration.

-- Step 1: re-parent legacy customer-visible messages on LINKED customer
-- tickets to the pair's conversation. Internal notes (is_internal = true) and
-- back-office/tracker messages are untouched (both predicates); soft-deleted
-- history moves too (no deleted_at filter — deleted rows are part of the
-- thread record and the agent view can surface them). The XOR CHECK
-- (conversation_messages_parent_check, num_nonnulls = 1) stays satisfied: the
-- swap is atomic per row. (The tickets join keys off tc.ticket_id — Postgres
-- forbids referencing the UPDATE target inside the FROM clause's JOIN ON;
-- keyed this way it is the identical row set.)
UPDATE "conversation_messages"
SET "conversation_id" = tc."conversation_id", "ticket_id" = NULL
FROM "ticket_conversations" tc
JOIN "tickets" t ON t."id" = tc."ticket_id"
WHERE "conversation_messages"."ticket_id" = tc."ticket_id"
  AND tc."ticket_type" = 'customer'
  AND t."type" = 'customer'
  AND "conversation_messages"."is_internal" = false;
--> statement-breakpoint

-- Step 2: backfill a backing conversation for every STANDALONE customer
-- ticket with a requester (no pair link, not soft-deleted), link the pair
-- (ticket_type 'customer'), and re-parent the ticket's customer-visible
-- messages onto it (same rule as step 1). One statement: the `standalone`
-- CTE mints the conversation id per ticket up front (typeids are uuid at the
-- DB level; the app-layer prefix is applied at read time), `conv` inserts the
-- conversation mirroring the ticket, `link` inserts the pair link (sibling
-- CTE effects satisfy the FK — verified Postgres behavior for data-modifying
-- CTEs), and the main UPDATE moves the messages. Mirrored columns follow the
-- 1b intake shape (ticket-intake.service.ts): channel + source 'web_form',
-- visitor = requester; status is 'closed' iff the ticket's status is
-- closed-category (resolved_at carried over), else 'open'; subject = title;
-- assigned agent = ticket assignee; priority, created_at carried; last
-- message at = the latest customer-visible message stamp (internal notes
-- never bump a conversation's lastMessageAt in the app either), falling back
-- to the ticket's creation. linked_by stays NULL (system migration); the
-- link's created_at mirrors the ticket's so the pair reads born-linked.
WITH "standalone" AS (
  SELECT
    t."id" AS "ticket_id",
    gen_random_uuid() AS "conversation_id",
    t."requester_principal_id",
    t."assignee_principal_id",
    t."priority",
    t."title",
    t."created_at",
    t."resolved_at",
    ts."category" AS "status_category"
  FROM "tickets" t
  JOIN "ticket_statuses" ts ON ts."id" = t."status_id"
  WHERE t."type" = 'customer'
    AND t."requester_principal_id" IS NOT NULL
    AND t."deleted_at" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "ticket_conversations" tc
      WHERE tc."ticket_id" = t."id" AND tc."ticket_type" = 'customer'
    )
),
"conv" AS (
  INSERT INTO "conversations" (
    "id",
    "visitor_principal_id",
    "assigned_agent_principal_id",
    "status",
    "source",
    "channel",
    "priority",
    "subject",
    "created_at",
    "last_message_at",
    "resolved_at"
  )
  SELECT
    s."conversation_id",
    s."requester_principal_id",
    s."assignee_principal_id",
    CASE WHEN s."status_category" = 'closed' THEN 'closed' ELSE 'open' END,
    'web_form',
    'web_form',
    s."priority",
    s."title",
    s."created_at",
    COALESCE(
      (
        SELECT max(cm."created_at")
        FROM "conversation_messages" cm
        WHERE cm."ticket_id" = s."ticket_id" AND cm."is_internal" = false
      ),
      s."created_at"
    ),
    CASE WHEN s."status_category" = 'closed' THEN s."resolved_at" END
  FROM "standalone" s
  RETURNING "id"
),
"link" AS (
  INSERT INTO "ticket_conversations" (
    "ticket_id",
    "conversation_id",
    "ticket_type",
    "linked_by_principal_id",
    "created_at"
  )
  SELECT
    s."ticket_id",
    s."conversation_id",
    'customer',
    NULL,
    s."created_at"
  FROM "standalone" s
  RETURNING "ticket_id", "conversation_id"
)
UPDATE "conversation_messages" cm
SET "conversation_id" = link."conversation_id", "ticket_id" = NULL
FROM "link"
WHERE cm."ticket_id" = link."ticket_id"
  AND cm."is_internal" = false;
