/**
 * The migration rule (MIGRATIONS.md), enforced on every numbered migration.
 *
 * `conversations`, `tickets`, `conversation_messages` and `events` grow large,
 * and the whole lineage runs in one transaction, so a statement that scans or
 * rewrites one of them holds its lock, and every lock taken before it, for as
 * long as the scan takes. On those tables a migration may not:
 *
 * - build an index (it goes in `CONCURRENT_INDEX_SPECS` or `DEFERRED_INDEX_SPECS`);
 * - update rows (a backfill is a startup backfill, `apps/web/src/lib/server/backfills`);
 * - add a foreign key or a check that is validated at once (add it `NOT VALID`, or
 *   write the foreign key inline on a new column);
 * - put a check inline on a new column (that scans the table too);
 * - add a column that references `principal` with no index on it (an `ON DELETE`
 *   scans the table on every principal delete).
 *
 * On any other table, a check on a column the same file adds is written inline
 * on the column, so a replay of the file is a no-op.
 *
 * Existing migrations that broke a rule before it existed are listed below and
 * never grow.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { is } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '../schema'
import {
  CONCURRENT_INDEX_SPECS,
  DEFERRED_INDEX_SPECS,
  type ConcurrentIndexSpec,
} from '../schema-ops'

const HOT_TABLES = ['conversations', 'tickets', 'conversation_messages', 'events'] as const
const DRIZZLE_DIR = path.resolve(__dirname, '../../drizzle')

type Rule =
  | 'hot-index'
  | 'hot-update'
  | 'hot-validated-constraint'
  | 'hot-inline-check'
  | 'hot-principal-column-unindexed'
  | 'separate-check-on-new-column'

interface Violation {
  file: string
  rule: Rule
  detail: string
}

/** `"public"."tickets"`, `tickets`, `ONLY "tickets"` -> `tickets`. */
const TABLE_NAME = String.raw`(?:ONLY\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`

function stripComments(sqlText: string): string {
  return sqlText.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function statements(sqlText: string): string[] {
  return stripComments(sqlText)
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Top-level clauses of an `ALTER TABLE` action list. */
function clauses(actions: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of actions) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

function isHot(table: string): boolean {
  return (HOT_TABLES as readonly string[]).includes(table)
}

/** Every index on `table` whose leading column is `column`, from the schema and both index lists. */
function indexedColumns(specs: readonly ConcurrentIndexSpec[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (table: string, column: string) => {
    let set = out.get(table)
    if (!set) out.set(table, (set = new Set()))
    set.add(column)
  }
  for (const value of Object.values(schema) as unknown[]) {
    if (!is(value, PgTable)) continue
    const config = getTableConfig(value as PgTable)
    for (const index of config.indexes) {
      const first = index.config.columns[0] as { name?: string } | undefined
      if (first?.name) add(config.name, first.name)
    }
  }
  const onTable = new RegExp(
    String.raw`\bON\s+${TABLE_NAME}\s*(?:USING\s+\w+\s*)?\(\s*"?([a-z_][a-z0-9_]*)"?`,
    'i'
  )
  for (const spec of specs) {
    const match = spec.ddl.match(onTable)
    if (match) add(match[1], match[2])
  }
  return out
}

/** The rule's violations in one migration file. */
function migrationRuleViolations(
  file: string,
  sqlText: string,
  indexed: Map<string, Set<string>>
): Violation[] {
  const out: Violation[] = []
  const addedColumns = new Map<string, Set<string>>()
  const createIndex = new RegExp(
    String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]*)"?\s+ON\s+${TABLE_NAME}`,
    'i'
  )
  const update = new RegExp(
    String.raw`\bUPDATE\s+${TABLE_NAME}\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b`,
    'gi'
  )
  const alter = new RegExp(
    String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${TABLE_NAME}\s+(.*)$`,
    'i'
  )
  const addColumn = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s+(.*)$/i
  const addConstraint = /^ADD\s+CONSTRAINT\s+"?[a-z0-9_]+"?\s+(FOREIGN\s+KEY|CHECK)\b(.*)$/i

  for (const statement of statements(sqlText)) {
    // DO blocks and functions are split mid-body; the clause matchers below
    // still find an ALTER TABLE inside them.
    const index = statement.match(createIndex)
    if (index && isHot(index[3]) && !index[1]) {
      out.push({ file, rule: 'hot-index', detail: `${index[3]} ${index[2]}` })
    }
    for (const match of statement.matchAll(update)) {
      if (isHot(match[1])) out.push({ file, rule: 'hot-update', detail: match[1] })
    }
    const at = statement.search(/\bALTER\s+TABLE\b/i)
    if (at < 0) continue
    const altered = statement.slice(at).match(alter)
    if (!altered) continue
    const table = altered[1]
    for (const clause of clauses(altered[2])) {
      const column = clause.match(addColumn)
      if (column && !/^CONSTRAINT\b/i.test(column[1])) {
        const name = column[1]
        let set = addedColumns.get(table)
        if (!set) addedColumns.set(table, (set = new Set()))
        set.add(name)
        if (isHot(table) && /\bCHECK\s*\(/i.test(column[2])) {
          out.push({ file, rule: 'hot-inline-check', detail: `${table}.${name}` })
        }
        if (
          isHot(table) &&
          /\bREFERENCES\s+(?:"?public"?\.)?"?principal"?/i.test(column[2]) &&
          !indexed.get(table)?.has(name)
        ) {
          out.push({ file, rule: 'hot-principal-column-unindexed', detail: `${table}.${name}` })
        }
        continue
      }
      const constraint = clause.match(addConstraint)
      if (!constraint) continue
      const kind = constraint[1].toUpperCase().startsWith('CHECK') ? 'CHECK' : 'FOREIGN KEY'
      if (isHot(table)) {
        if (!/\bNOT\s+VALID\b/i.test(constraint[2])) {
          out.push({ file, rule: 'hot-validated-constraint', detail: `${table} ${kind}` })
        }
        continue
      }
      if (kind === 'CHECK') {
        const added = addedColumns.get(table)
        const names = [...(added ?? [])].filter((c) =>
          new RegExp(String.raw`\b"?${c}"?\b`).test(constraint[2])
        )
        if (names.length > 0) {
          out.push({
            file,
            rule: 'separate-check-on-new-column',
            detail: `${table}.${names.join(',')}`,
          })
        }
      }
    }
  }
  return out
}

/** Violations that predate the rule. This list only ever shrinks. */
const KNOWN_EXCEPTIONS: readonly string[] = [
  '0085_live_chat.sql hot-index conversations conversations_assigned_agent_idx',
  '0085_live_chat.sql hot-index conversations conversations_status_last_message_idx',
  '0085_live_chat.sql hot-index conversations conversations_visitor_principal_idx',
  '0098_normalize_snoozed_conversations.sql hot-update conversations',
  '0124_conversation_channel_messenger.sql hot-update conversations',
  '0139_conversation_lifecycle.sql hot-index conversations conversations_last_message_at_id_idx',
  '0139_conversation_lifecycle.sql hot-index conversations conversations_snoozed_until_idx',
  '0139_conversation_lifecycle.sql hot-update conversations',
  '0145_teams.sql hot-index conversations conversations_assigned_team_idx',
  '0145_teams.sql hot-validated-constraint conversations FOREIGN KEY',
  '0148_conversation_views.sql hot-index conversations conversations_created_at_id_idx',
  '0148_conversation_views.sql hot-index conversations conversations_waiting_since_id_idx',
  '0150_tickets.sql hot-index tickets tickets_assignee_principal_id_idx',
  '0150_tickets.sql hot-index tickets tickets_company_id_idx',
  '0150_tickets.sql hot-index tickets tickets_number_uq',
  '0150_tickets.sql hot-index tickets tickets_requester_principal_id_idx',
  '0150_tickets.sql hot-index tickets tickets_status_id_idx',
  '0150_tickets.sql hot-index tickets tickets_type_status_id_idx',
  '0150_tickets.sql hot-validated-constraint tickets FOREIGN KEY',
  '0151_message_polymorphism.sql hot-index conversation_messages conversation_messages_search_vector_idx',
  '0151_message_polymorphism.sql hot-index conversation_messages conversation_messages_ticket_created_idx',
  '0151_message_polymorphism.sql hot-validated-constraint conversation_messages CHECK',
  '0151_message_polymorphism.sql hot-validated-constraint conversation_messages FOREIGN KEY',
  '0152_email_channel.sql hot-index conversations conversations_channel_account_id_idx',
  '0152_email_channel.sql hot-validated-constraint conversations FOREIGN KEY',
  '0173_conversation_messages_style_idx.sql hot-index conversation_messages conversation_messages_style_mining_idx',
  '0177_unified_inbox.sql hot-index tickets tickets_created_at_id_idx',
  '0177_unified_inbox.sql hot-index tickets tickets_updated_at_id_idx',
  '0177_unified_inbox.sql hot-update tickets',
  '0177_unified_inbox.sql separate-check-on-new-column assistant_pending_actions.ticket_id',
  '0186_conversations_sla_applied_idx.sql hot-index conversations conversations_sla_applied_idx',
  '0187_conversations_sla_unsettled_idx.sql hot-index conversations conversations_sla_unsettled_idx',
  '0192_events_outbox.sql hot-index events events_dedupe_idx',
  '0192_events_outbox.sql hot-index events events_entity_idx',
  '0192_events_outbox.sql hot-index events events_event_id_idx',
  '0192_events_outbox.sql hot-index events events_type_idx',
  '0192_events_outbox.sql hot-index events events_unpublished_idx',
  '0196_assistant_config_v2.sql separate-check-on-new-column assistant_guidance_rules.applies_when',
  '0196_assistant_config_v2.sql separate-check-on-new-column assistant_guidance_rules.roles',
  '0198_roadmap_views.sql separate-check-on-new-column roadmaps.base_filter',
  '0198_roadmap_views.sql separate-check-on-new-column roadmaps.date_source',
  '0198_roadmap_views.sql separate-check-on-new-column roadmaps.frequency',
  '0198_roadmap_views.sql separate-check-on-new-column roadmaps.type',
  '0198_roadmap_views.sql separate-check-on-new-column roadmaps.type,date_source,frequency',
  '0198_roadmap_views.sql separate-check-on-new-column roadmaps.visibility',
  '0198_roadmap_views.sql separate-check-on-new-column roadmaps.visible_segment_ids',
  '0204_assistant_config_v3.sql separate-check-on-new-column assistant_guidance_rules.agent',
  '0207_index_tuning.sql hot-index conversation_messages conversation_messages_deleted_by_principal_idx',
  '0207_index_tuning.sql hot-index tickets tickets_assignee_team_idx',
  '0210_inbound_delivery_dedup.sql hot-index conversation_messages conversation_messages_inbound_delivery_key_idx',
  '0212_ticket_sla_holidays.sql hot-index tickets tickets_sla_unsettled_idx',
  '0212_ticket_sla_holidays.sql separate-check-on-new-column sla_events.ticket_id',
  '0213_conversations_sla_nrt_unsettled_idx.sql hot-index conversations conversations_sla_unsettled_idx',
  '0215_ticket_types.sql hot-index tickets tickets_ticket_type_id_idx',
  '0215_ticket_types.sql hot-update tickets',
  '0215_ticket_types.sql hot-validated-constraint tickets FOREIGN KEY',
  '0218_customer_messages_reparent_backfill.sql hot-update conversation_messages',
  '0219_search_and_unread_indexes.sql hot-index conversation_messages conversation_messages_unread_count_idx',
  '0221_remove_web_form_channel.sql hot-update conversations',
  '0252_conversation_spam_retention_idx.sql hot-index conversations conversations_spam_resolved_at_idx',
  '0253_event_dispatch_owner.sql hot-validated-constraint events CHECK',
  '0270_github_channel.sql hot-index conversation_messages conversation_messages_github_comment_id_idx',
  '0274_slack_agent_gateway.sql separate-check-on-new-column assistant_pending_actions.workspace_thread_key',
  '0294_workspace_copilot.sql hot-index conversation_messages conversation_messages_workspace_created_idx',
  '0294_workspace_copilot.sql hot-index conversation_messages conversation_messages_workspace_run_sender_idx',
]

function key(v: Violation): string {
  return `${v.file} ${v.rule} ${v.detail}`
}

const SPECS = [...CONCURRENT_INDEX_SPECS, ...DEFERRED_INDEX_SPECS]

function check(sqlText: string, specs: readonly ConcurrentIndexSpec[] = SPECS): Violation[] {
  return migrationRuleViolations('9999_sample.sql', sqlText, indexedColumns(specs))
}

describe('the migration rule on the shipped migrations', () => {
  const files = readdirSync(DRIZZLE_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
  const indexed = indexedColumns(SPECS)
  const found = files.flatMap((file) =>
    migrationRuleViolations(file, readFileSync(path.join(DRIZZLE_DIR, file), 'utf8'), indexed)
  )

  it('reads every migration file', () => {
    const journal = JSON.parse(
      readFileSync(path.join(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8')
    ) as { entries: unknown[] }
    expect(files.length).toBe(journal.entries.length)
  })

  it('has no violation beyond the ones that predate it', () => {
    const known = new Set(KNOWN_EXCEPTIONS)
    expect(found.map(key).filter((k) => !known.has(k))).toEqual([])
  })

  it('lists no exception that no longer occurs', () => {
    const now = new Set(found.map(key))
    expect(KNOWN_EXCEPTIONS.filter((k) => !now.has(k))).toEqual([])
  })

  it('puts each index in one list: built at boot or in the background, never both', () => {
    const boot = new Set(CONCURRENT_INDEX_SPECS.map((s) => s.name))
    expect(DEFERRED_INDEX_SPECS.filter((s) => boot.has(s.name)).map((s) => s.name)).toEqual([])
  })
})

describe('the migration rule on sample migrations', () => {
  it('refuses an index built inside the migration on a hot table, on any spelling', () => {
    expect(check('CREATE INDEX tickets_x_idx ON tickets (x);').map((v) => v.rule)).toEqual([
      'hot-index',
    ])
    expect(
      check(
        'CREATE UNIQUE INDEX IF NOT EXISTS "c_x" ON "public"."conversations" USING btree ("x");'
      )
    ).toHaveLength(1)
    expect(check('CREATE INDEX posts_x_idx ON posts (x);')).toEqual([])
  })

  it('refuses an update of a hot table', () => {
    expect(check(`UPDATE "tickets" SET "priority" = 'none' WHERE "priority" IS NULL;`)).toEqual([
      { file: '9999_sample.sql', rule: 'hot-update', detail: 'tickets' },
    ])
    expect(check(`UPDATE roles SET name = 'Admin' WHERE key = 'admin';`)).toEqual([])
  })

  it('refuses a foreign key added without NOT VALID on a hot table', () => {
    expect(
      check(
        'ALTER TABLE tickets ADD CONSTRAINT tickets_x_fk FOREIGN KEY (x) REFERENCES teams(id);'
      ).map((v) => v.rule)
    ).toEqual(['hot-validated-constraint'])
    expect(
      check(
        'ALTER TABLE tickets ADD CONSTRAINT tickets_x_fk FOREIGN KEY (x) REFERENCES teams(id) NOT VALID;'
      )
    ).toEqual([])
  })

  it('refuses a check on a new hot-table column written inline, and takes it NOT VALID in a guard', () => {
    expect(
      check(
        `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS kind text CHECK (kind IN ('a', 'b'));`
      ).map((v) => v.rule)
    ).toEqual(['hot-inline-check'])
    expect(
      check(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS kind text;
-- @replay: guarded-by the constraint name in pg_constraint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_kind_ck') THEN
    ALTER TABLE tickets ADD CONSTRAINT tickets_kind_ck CHECK (kind IN ('a', 'b')) NOT VALID;
  END IF;
END $$;`)
    ).toEqual([])
  })

  it('takes a foreign key written inline on a new hot-table column', () => {
    expect(
      check(
        'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES tickets(id) ON DELETE SET NULL;'
      )
    ).toEqual([])
  })

  it('refuses a person column on a hot table with no index, and takes it with a background index', () => {
    const migration =
      'ALTER TABLE tickets ADD COLUMN IF NOT EXISTS x_by_principal_id uuid REFERENCES principal(id) ON DELETE SET NULL;'
    expect(check(migration)).toEqual([
      {
        file: '9999_sample.sql',
        rule: 'hot-principal-column-unindexed',
        detail: 'tickets.x_by_principal_id',
      },
    ])
    const deferred: ConcurrentIndexSpec = {
      name: 'tickets_x_by_principal_idx',
      concurrent: true,
      ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS tickets_x_by_principal_idx ON tickets (x_by_principal_id) WHERE x_by_principal_id IS NOT NULL',
    }
    expect(check(migration, [...SPECS, deferred])).toEqual([])
  })

  it('refuses a separate check for a column the same file adds to a small table, and takes it inline', () => {
    expect(
      check(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE roles ADD CONSTRAINT roles_tier_ck CHECK (tier IN ('a', 'b'));`).map((v) => v.rule)
    ).toEqual(['separate-check-on-new-column'])
    expect(
      check(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS tier text CHECK (tier IN ('a', 'b'));`)
    ).toEqual([])
  })
})
