-- Quinn Phase 1: config v3 — the single-page "AI agent" config becomes two peer
-- agents (Agent, Copilot) under one shared identity. One settings row, one
-- revision counter, one write funnel — unchanged mechanics (D3). This migration
-- reshapes the stored jsonb, splits guidance rules onto an `agent` column (D4),
-- and rewrites the voice managed-field paths. No dual-read: the strict reader
-- accepts only v3 after this.

-- 1. Reshape settings.assistant_config v2 -> v3.
--      voice -> agents.agent.voice verbatim; agents.copilot initialized to
--      defaults; identity carried over; version bumped to 3.
--      toolControls no longer exists (removed by D14/migration 0202 before this
--      runs). Copilot's posts+pastConversations default true regardless of the
--      assistantKnowledge flag: the §2 flag mapping only ever turns them ON and
--      the v3 default already has them ON, so it collapses to an unconditional
--      true. Knowledge toggles are config-only in Phase 1 (runtime still reads
--      the assistantKnowledge flag), so this reshape has no runtime effect yet.
UPDATE settings
SET assistant_config = jsonb_build_object(
  'version', 3,
  'identity', assistant_config->'identity',
  'agents', jsonb_build_object(
    'agent', jsonb_build_object(
      'voice', assistant_config->'voice',
      'knowledge', jsonb_build_object(
        'helpCenter', true,
        'posts', false,
        'changelog', false,
        'status', false
      )
    ),
    'copilot', jsonb_build_object(
      'capabilities', jsonb_build_object('qa', true, 'suggestedReplies', true),
      'knowledge', jsonb_build_object(
        'helpCenter', true,
        'posts', true,
        'pastConversations', true,
        'internalNotes', true,
        'tickets', false,
        'changelog', false,
        'status', true
      )
    )
  )
)
WHERE assistant_config->>'version' = '2';
--> statement-breakpoint
-- 2. Rewrite the assistant_config column default to the v3 shape.
ALTER TABLE "settings" ALTER COLUMN "assistant_config" SET DEFAULT '{"version":3,"identity":{"name":"Quinn","avatarUrl":null},"agents":{"agent":{"voice":{"tone":"balanced","responseLength":"balanced","additionalInstructions":""},"knowledge":{"helpCenter":true,"posts":false,"changelog":false,"status":false}},"copilot":{"capabilities":{"qa":true,"suggestedReplies":true},"knowledge":{"helpCenter":true,"posts":true,"pastConversations":true,"internalNotes":true,"tickets":false,"changelog":false,"status":true}}}}'::jsonb;
--> statement-breakpoint
-- 3. Rewrite voice managed-field paths: `assistant.voice.*` -> `assistant.agents.agent.voice.*`
--      (and the bare `assistant.voice`), leaving every other managed path
--      untouched. The voice section is the only configurable one whose dotted
--      path moved.
-- managed_field_paths is a jsonb string array, not text[] — element access via
-- jsonb_array_elements_text, rebuild via jsonb_agg (COALESCE keeps [] for empty).
UPDATE settings
SET managed_field_paths = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem = 'assistant.voice'
          THEN 'assistant.agents.agent.voice'
        WHEN elem LIKE 'assistant.voice.%'
          THEN 'assistant.agents.agent.' || substring(elem FROM length('assistant.') + 1)
        ELSE elem
      END
    )
    FROM jsonb_array_elements_text(managed_field_paths) AS elem
  ),
  '[]'::jsonb
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(managed_field_paths) AS e
  WHERE e = 'assistant.voice' OR e LIKE 'assistant.voice.%'
);
--> statement-breakpoint
-- 4. Guidance rules: roles[] -> a single owning agent (D4).
--      First add the column nullable so the backfill can populate it.
--      IF NOT EXISTS is belt-and-braces: the drizzle migrator runs this whole
--      file in one transaction (a mid-file failure rolls back cleanly, verified),
--      so partial-state retries can't actually happen — the transaction is the
--      real protection. Same rationale for the NOT EXISTS guard on 4a below.
ALTER TABLE "assistant_guidance_rules" ADD COLUMN IF NOT EXISTS "agent" text;
--> statement-breakpoint
-- 4a. A rule matching BOTH a customer-facing role and copilot_qa produces TWO
--       rows: the original becomes the Agent rule (step 4b), and this inserts an
--       independent Copilot copy. The name is suffixed " (Copilot)" with the base
--       truncated first — left(name, 80 - length(suffix)) || suffix — so the
--       suffix is never itself clipped and two distinct base names can't collide
--       at exactly 80 chars. Copies evolve independently from here (D4).
--       The id is minted with gen_random_uuid() (UUIDv4), matching how every
--       prior backfill migration synthesizes ids at the SQL layer (see 0145).
--       This is a deliberate exception to the app-layer time-ordered UUIDv7
--       convention (typeIdWithDefault) for these few synthesized rows; the app
--       reads the value back as a rule_* TypeID either way.
--       The NOT EXISTS guard makes the re-insert a no-op if this step somehow
--       re-runs (the transaction above is the actual guarantee).
INSERT INTO "assistant_guidance_rules"
  (id, name, applies_when, instruction, agent, enabled, priority, created_by_id, created_at, updated_at)
SELECT
  gen_random_uuid(),
  left(name, 80 - length(' (Copilot)')) || ' (Copilot)',
  applies_when,
  instruction,
  'copilot',
  enabled,
  priority,
  created_by_id,
  created_at,
  updated_at
FROM "assistant_guidance_rules" AS src
WHERE 'copilot_qa' = ANY(roles)
  AND ('customer_support' = ANY(roles) OR 'suggested_reply' = ANY(roles))
  AND NOT EXISTS (
    SELECT 1 FROM "assistant_guidance_rules" AS copy
    WHERE copy.agent = 'copilot'
      AND copy.name = left(src.name, 80 - length(' (Copilot)')) || ' (Copilot)'
      AND copy.applies_when = src.applies_when
      AND copy.instruction = src.instruction
  );
--> statement-breakpoint
-- 4b. Resolve the agent for every original row (agent IS NULL skips the copies
--       just inserted, which are already 'copilot'). A rule intersecting the
--       customer-facing roles -> 'agent'; a copilot_qa-only rule -> 'copilot'.
UPDATE "assistant_guidance_rules"
SET agent = CASE
  WHEN 'customer_support' = ANY(roles) OR 'suggested_reply' = ANY(roles) THEN 'agent'
  ELSE 'copilot'
END
WHERE agent IS NULL;
--> statement-breakpoint
-- 4c. Lock the column down and drop the now-unused roles column (which drops its
--       cardinality check with it).
ALTER TABLE "assistant_guidance_rules" ALTER COLUMN "agent" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules"
  ADD CONSTRAINT "assistant_guidance_rules_agent_check" CHECK ("agent" IN ('agent', 'copilot'));
--> statement-breakpoint
ALTER TABLE "assistant_guidance_rules" DROP COLUMN "roles";
