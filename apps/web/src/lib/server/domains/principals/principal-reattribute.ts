/**
 * Deleted-user placeholder, and the registry of authored content re-attributed
 * to it when a portal user is removed.
 *
 * Removing a portal user tears down the principal row, and the FK topology
 * splits that person's footprint in two:
 * - ON DELETE CASCADE / SET NULL columns hold derived or actor state (votes,
 *   subscriptions, notification preferences, moderation stamps). Postgres
 *   tears those down or detaches them, which is the intended outcome.
 * - ON DELETE RESTRICT columns hold authored content — posts, comments,
 *   conversation threads, help-center articles, run provenance. The database
 *   refuses to orphan them, so the delete cannot proceed until they are moved.
 *
 * Those RESTRICT rows are re-attributed to one workspace-wide placeholder
 * principal rather than deleted, so a thread stays readable and a discussion
 * keeps its shape after a participant leaves. The placeholder is provisioned
 * lazily on the first removal, holds no `user` row and no account, and so can
 * never authenticate; every author-display path reads `principal.display_name`,
 * which renders it as the deleted-user label. Because it has no `user` row, the
 * people listers (which all inner-join `user`) never surface it.
 *
 * Every RESTRICT reference to `principal.id` must appear in REATTRIBUTE_STEPS.
 * The schema-walking test (principal-reattribute-completeness.test.ts) enforces
 * that, so a new RESTRICT column cannot ship and quietly reintroduce the
 * foreign-key failure this registry exists to prevent.
 */
import type { PrincipalId } from '@quackback/ids'
import {
  conversationMessages,
  conversations,
  conversationSummaries,
  eq,
  exportRuns,
  helpCenterArticles,
  importRuns,
  postComments,
  postNotes,
  posts,
  principal,
  type Transaction,
} from '@/lib/server/db'

/**
 * The placeholder's id is fixed rather than generated: it is a singleton, so a
 * constant makes find-or-create a primary-key upsert and keeps the row
 * recognisable in a database dump. Spelled as a literal, not derived through
 * `fromUuid`, so importing this module costs nothing at load time — it sits on
 * the import path of the whole users domain. It encodes the nil UUID;
 * principal-reattribute-completeness.test.ts pins that round trip.
 */
export const DELETED_USER_PRINCIPAL_ID = 'principal_00000000000000000000000000' as PrincipalId

/** Display name every author surface renders for re-attributed content. */
export const DELETED_USER_DISPLAY_NAME = 'Deleted user'

export interface ReattributeStep {
  /** SQL table name this step moves (matches getTableName). */
  table: string
  /** SQL column name on that table holding the authored-by reference. */
  column: string
  /** What the content is, and why it outlives its author. */
  description: string
  run(tx: Transaction, from: PrincipalId, to: PrincipalId): Promise<void>
}

/**
 * Loosely-typed drizzle table handle: the column set varies per table, and the
 * factory addresses the column by its TS key.
 */
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
type ReattributeTable = any

/** `principal_id` -> `principalId`: derive the drizzle TS key from the SQL name. */
function columnKey(column: string): string {
  return column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * One re-attribution as a single UPDATE. Safe for every column in the registry
 * because none of them participates in a unique constraint, so the placeholder
 * can accumulate rows from any number of removals without colliding.
 */
function reattribute(
  table: string,
  dbTable: ReattributeTable,
  column: string,
  description: string
): ReattributeStep {
  const key = columnKey(column)
  return {
    table,
    column,
    description,
    async run(tx, from, to) {
      await tx
        .update(dbTable)
        .set({ [key]: to })
        .where(eq(dbTable[key], from))
    },
  }
}

/** Every ON DELETE RESTRICT reference to a principal, in no significant order. */
export const REATTRIBUTE_STEPS: ReattributeStep[] = [
  reattribute(
    'posts',
    posts,
    'principal_id',
    'Post authorship. The post is the unit of feedback other people vote and comment on, so it outlives its author.'
  ),
  reattribute(
    'post_comments',
    postComments,
    'principal_id',
    'Comment authorship. Removing a comment would tear the replies under it out of context.'
  ),
  reattribute(
    'post_notes',
    postNotes,
    'principal_id',
    'Internal staff notes. Authored by team members, so only reachable here for a teammate demoted to a portal user, but the note is workspace knowledge either way.'
  ),
  reattribute(
    'kb_articles',
    helpCenterArticles,
    'principal_id',
    'Help-center article authorship. A published article is workspace content, not something its author takes with them.'
  ),
  reattribute(
    'conversations',
    conversations,
    'visitor_principal_id',
    'Conversation ownership. The support history stays readable, attributed to the placeholder in place of the person who left.'
  ),
  reattribute(
    'conversation_messages',
    conversationMessages,
    'principal_id',
    'Message authorship, for the same reason as the conversation that holds it.'
  ),
  reattribute(
    'conversation_summaries',
    conversationSummaries,
    'visitor_principal_id',
    'Denormalized from conversations.visitor_principal_id; it follows the conversation so the customer-scoped retrieval it exists for keeps matching.'
  ),
  reattribute(
    'export_runs',
    exportRuns,
    'initiated_by_principal_id',
    'Export provenance. Who pulled data out is a compliance record, so it is preserved rather than dropped with the actor.'
  ),
  reattribute(
    'import_runs',
    importRuns,
    'initiated_by_principal_id',
    'Import provenance, for the same reason as export_runs.'
  ),
]

/**
 * Find-or-create the placeholder. A primary-key upsert, so two concurrent
 * removals converge on the same row.
 */
export async function ensureDeletedUserPrincipal(tx: Transaction): Promise<PrincipalId> {
  await tx
    .insert(principal)
    .values({
      id: DELETED_USER_PRINCIPAL_ID,
      userId: null,
      role: 'user',
      type: 'user',
      displayName: DELETED_USER_DISPLAY_NAME,
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: principal.id })
  return DELETED_USER_PRINCIPAL_ID
}

/**
 * Move every piece of authored content owned by `from` onto the placeholder,
 * inside the caller's transaction, leaving the principal free to be deleted.
 * Returns the placeholder it re-attributed to.
 */
export async function reattributeAuthoredContent(
  tx: Transaction,
  from: PrincipalId
): Promise<PrincipalId> {
  const to = await ensureDeletedUserPrincipal(tx)
  for (const step of REATTRIBUTE_STEPS) {
    await step.run(tx, from, to)
  }
  return to
}
