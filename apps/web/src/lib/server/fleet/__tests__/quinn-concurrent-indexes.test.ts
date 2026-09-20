import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CONCURRENT_INDEX_SPECS } from '@quackback/db/schema-ops'

const indexes = [
  [
    '0286_quinn_active_involvement.sql',
    'assistant_involvements_one_active_idx',
    "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS assistant_involvements_one_active_idx ON assistant_involvements (conversation_id) WHERE status = 'active'",
  ],
  [
    '0287_quinn_durable_runs.sql',
    'conversation_messages_assistant_run_terminal_idx',
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "conversation_messages_assistant_run_terminal_idx" ON "conversation_messages" ("assistant_run_id") WHERE "assistant_run_id" IS NOT NULL AND "is_internal" = false',
  ],
  [
    '0289_quinn_replayable_actions.sql',
    'assistant_tool_calls_action_key_idx',
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "assistant_tool_calls_action_key_idx" ON "assistant_tool_calls" ("action_key") WHERE "action_key" IS NOT NULL',
  ],
  [
    '0289_quinn_replayable_actions.sql',
    'assistant_tool_calls_reconciliation_idx',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "assistant_tool_calls_reconciliation_idx" ON "assistant_tool_calls" ("created_at") WHERE "reconciliation_state" = \'required\'',
  ],
  [
    '0289_quinn_replayable_actions.sql',
    'assistant_pending_actions_execution_idx',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "assistant_pending_actions_execution_idx" ON "assistant_pending_actions" ("proposed_at") WHERE "execution_state" IN (\'queued\', \'running\', \'unknown\')',
  ],
  [
    '0290_quinn_internal_feedback.sql',
    'posts_capture_key_uidx',
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "posts_capture_key_uidx" ON "posts" ("capture_key") WHERE "capture_key" IS NOT NULL',
  ],
  [
    '0290_quinn_internal_feedback.sql',
    'posts_internal_audience_idx',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "posts_internal_audience_idx" ON "posts" ("created_at") WHERE "audience" <> \'board\'',
  ],
] as const

it.each(indexes)('%s builds %s outside the lineage transaction', (file, name, ddl) => {
  const spec = CONCURRENT_INDEX_SPECS.find((spec) => spec.name === name)
  expect(spec).toEqual({ name, concurrent: true, ddl })
  const migration = readFileSync(
    join(__dirname, '../../../../../../../packages/db/drizzle', file),
    'utf8'
  )
  expect(migration).not.toMatch(new RegExp(`CREATE (?:UNIQUE )?INDEX[^;]*${name}`))
})
