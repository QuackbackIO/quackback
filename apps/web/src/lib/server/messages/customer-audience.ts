/**
 * The customer audience rule for thread reads: what a customer (messenger,
 * portal, widget, requester ticket view) may see of a thread. Shared by the
 * conversation and ticket domains so the rule exists exactly once.
 *
 * A customer sees public rows only (`is_internal = false`), and never a
 * team-only system notice. Assignment notices are written internal today, but
 * rows written before that were public. Those legacy rows are hidden here at
 * read time instead of by a data migration:
 *  - the teammate notice carries `metadata.systemEvent.kind = 'assigned'`;
 *  - the team notice carried no structured event, only its fixed English
 *    content, "Conversation assigned to the <team> team". Only the server
 *    writes system rows, so the content prefix cannot be forged by a sender.
 */
import type { SQL } from 'drizzle-orm'
import { sql, conversationMessages } from '@/lib/server/db'

/** System notice kinds a customer never sees, whatever the row's `is_internal`. */
export const TEAM_ONLY_SYSTEM_NOTICE_KINDS = ['assigned', 'team_assigned'] as const

/** The fixed English content every assignment notice starts with. */
const ASSIGNMENT_NOTICE_PREFIX = 'Conversation assigned to %'

/** The `conversation_messages` columns the rule reads. Raw SQL fragments stand
 *  in when a query aliases the table (e.g. `cm.is_internal`). */
export interface CustomerAudienceColumns {
  isInternal: SQL | typeof conversationMessages.isInternal
  senderType: SQL | typeof conversationMessages.senderType
  content: SQL | typeof conversationMessages.content
  metadata: SQL | typeof conversationMessages.metadata
}

const MESSAGE_COLUMNS: CustomerAudienceColumns = {
  isInternal: conversationMessages.isInternal,
  senderType: conversationMessages.senderType,
  content: conversationMessages.content,
  metadata: conversationMessages.metadata,
}

/**
 * WHERE fragment for a customer read of `conversation_messages`: public rows
 * that are not team-only system notices. Defaults to the table's own columns;
 * pass `cols` when the query aliases the table in raw SQL. The kind is
 * coalesced so a row with no metadata never turns the notice test NULL (which
 * `NOT` would keep NULL and silently drop the row).
 */
export function customerVisibleMessageSql(cols: CustomerAudienceColumns = MESSAGE_COLUMNS): SQL {
  const kinds = sql.join(
    TEAM_ONLY_SYSTEM_NOTICE_KINDS.map((kind) => sql`${kind}`),
    sql`, `
  )
  return sql`(${cols.isInternal} = false AND NOT (${cols.senderType} = 'system' AND (
    coalesce(${cols.metadata} -> 'systemEvent' ->> 'kind', '') IN (${kinds})
    OR ${cols.content} LIKE ${ASSIGNMENT_NOTICE_PREFIX}
  )))`
}
