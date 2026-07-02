/**
 * Principal re-point registry: the single source of truth for what happens to
 * a principal's activity when one principal is merged into another.
 *
 * Merge direction is strictly anonymous-to-identified, and the attribute
 * conflict rule is USER WINS: the identified principal's data is never
 * overwritten; the anonymous side only fills gaps (see the contact_email
 * step). On unique-constraint collisions the anonymous row is dropped and the
 * identified principal's row survives.
 *
 * Every table with a principal reference must appear here as a step or in
 * REPOINT_EXEMPTIONS with a reason; the schema-walking completeness test
 * (principal-repoint-completeness.test.ts) enforces that, so a new
 * principal-referencing table cannot ship without a merge decision.
 *
 * REQUIREMENT for that audit to work: a soft principal reference (a column
 * with no FK) MUST be named `principal_id` or `*_principal_id`. A soft
 * reference under any other name and without a real FK to principal.id is
 * invisible to the completeness walk — the audit's one blind spot — and
 * would silently strand rows on merge.
 *
 * Callers: mergeAnonymousToIdentified (widget identify previousToken merge,
 * portal sign-in to an existing account) and absorbSignupIntoAnonymous (the
 * anonymous plugin's onLinkAccount signup absorb), both in
 * auth/merge-anonymous.ts. Identity teardown afterwards is the factory's
 * deleteAnonymousIdentity.
 */
import { toUuid, type PrincipalId } from '@quackback/ids'
import {
  postVotes,
  postCommentReactions,
  postComments,
  posts,
  postEditHistory,
  postCommentEditHistory,
  postActivity,
  conversations,
  conversationMessages,
  postSubscriptions,
  inAppNotifications,
  pageViews,
  visitorDevices,
  userSegments,
  helpCenterArticleFeedback,
  principal,
  eq,
  and,
  ne,
  isNull,
  sql,
  type Transaction,
} from '@/lib/server/db'

export interface RepointOptions {
  /**
   * Display names for the in-app notification title fixup ("Curious Penguin
   * commented" becomes "Jane Doe commented"). Omitted on the signup-absorb
   * path, which has no meaningful source name; the fixup is skipped.
   */
  displayNames?: { from: string; to: string }
}

interface RepointContext extends RepointOptions {
  from: PrincipalId
  to: PrincipalId
}

export interface RepointStep {
  /** SQL table name this step migrates (matches getTableName). */
  table: string
  /** SQL column names on that table this step handles. */
  columns: string[]
  /** Why/how the rows move, including any collision semantics. */
  description: string
  run(tx: Transaction, ctx: RepointContext): Promise<void>
}

// ============================================================================
// Step factories
// ============================================================================

/**
 * Loosely-typed drizzle table handle for the factories: the column set varies
 * per table, and the factories address columns by their TS key.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RepointTable = any

/** `principal_id` -> `principalId`: derive the drizzle TS key from the SQL name. */
function columnKey(column: string): string {
  return column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** A step that re-points one column with a single UPDATE (no unique constraint). */
function simpleRepoint(
  table: string,
  dbTable: RepointTable,
  column: string,
  description: string
): RepointStep {
  const key = columnKey(column)
  return {
    table,
    columns: [column],
    description,
    async run(tx, { from, to }) {
      await tx
        .update(dbTable)
        .set({ [key]: to })
        .where(eq(dbTable[key], from))
    },
  }
}

/**
 * A step for a table with a unique constraint over (column, ...uniqueCols):
 * anon rows that would collide with an existing identified row are dropped
 * (the identified row wins), then the survivors are re-pointed.
 */
function collisionRepoint(
  table: string,
  dbTable: RepointTable,
  column: string,
  uniqueCols: string[],
  description: string
): RepointStep {
  const key = columnKey(column)
  return {
    table,
    columns: [column],
    description,
    async run(tx, { from, to }) {
      // Raw fragments bypass the TypeID column mapper: embed uuids, not TypeIDs.
      let match = sql`t.${sql.raw(column)} = ${toUuid(to)}`
      for (const uniqueCol of uniqueCols) {
        match = sql`${match} AND t.${sql.raw(uniqueCol)} = ${dbTable[columnKey(uniqueCol)]}`
      }
      await tx
        .delete(dbTable)
        .where(
          and(
            eq(dbTable[key], from),
            sql`EXISTS (SELECT 1 FROM ${sql.raw(table)} t WHERE ${match})`
          )
        )
      await tx
        .update(dbTable)
        .set({ [key]: to })
        .where(eq(dbTable[key], from))
    },
  }
}

/**
 * Ordered re-point steps. Ordering constraints:
 * - in_app_notifications must run before post_comments (it finds the anon
 *   user's comments by principal_id).
 * - Everything here runs before identity teardown; conversation tables are
 *   ON DELETE RESTRICT, so a missed re-point would abort the merge, while
 *   CASCADE tables would silently lose rows.
 */
export const REPOINT_STEPS: RepointStep[] = [
  collisionRepoint(
    'post_votes',
    postVotes,
    'principal_id',
    ['post_id'],
    'Votes; unique (post_id, principal_id). The identified vote wins: colliding anon votes are dropped.'
  ),
  collisionRepoint(
    'post_comment_reactions',
    postCommentReactions,
    'principal_id',
    ['comment_id', 'emoji'],
    'Comment reactions; unique (comment_id, principal_id, emoji). Colliding anon reactions are dropped.'
  ),
  {
    table: 'in_app_notifications',
    columns: ['principal_id'],
    description:
      'Recipient re-point, plus fixups for the anon comments about to transfer: notifications the target received about them become self-notifications (deleted), and titles swap the anon display name for the real one. Must run before the post_comments step.',
    async run(tx, { from, to, displayNames }) {
      const aboutAnonComment = sql`EXISTS (SELECT 1 FROM post_comments c WHERE c.id = ${inAppNotifications.commentId} AND c.principal_id = ${toUuid(from)})`
      await tx
        .delete(inAppNotifications)
        .where(and(eq(inAppNotifications.principalId, to), aboutAnonComment))
      if (displayNames) {
        await tx
          .update(inAppNotifications)
          .set({
            title: sql`REPLACE(${inAppNotifications.title}, ${displayNames.from}, ${displayNames.to})`,
          })
          .where(aboutAnonComment)
      }
      await tx
        .update(inAppNotifications)
        .set({ principalId: to })
        .where(eq(inAppNotifications.principalId, from))
    },
  },
  simpleRepoint('post_comments', postComments, 'principal_id', 'Comment authorship.'),
  simpleRepoint('posts', posts, 'principal_id', 'Post authorship.'),
  simpleRepoint(
    'post_edit_history',
    postEditHistory,
    'editor_principal_id',
    'Edit attribution. Authors can edit their own posts, so anonymous editors exist; re-pointing keeps the trail and avoids FK trouble on teardown.'
  ),
  simpleRepoint(
    'post_comment_edit_history',
    postCommentEditHistory,
    'editor_principal_id',
    'Comment edit attribution (same reasoning as post_edit_history).'
  ),
  simpleRepoint(
    'post_activity',
    postActivity,
    'principal_id',
    'Activity-feed attribution. Anon actors write entries (e.g. deleting their own comment); without a re-point the teardown nulls the actor.'
  ),
  simpleRepoint(
    'conversations',
    conversations,
    'visitor_principal_id',
    'Conversation ownership. ON DELETE RESTRICT: a missed re-point aborts the merge at teardown.'
  ),
  simpleRepoint(
    'conversation_messages',
    conversationMessages,
    'principal_id',
    'Message authorship. ON DELETE RESTRICT, same as conversations.'
  ),
  collisionRepoint(
    'post_subscriptions',
    postSubscriptions,
    'principal_id',
    ['post_id'],
    'Subscriptions; unique (post_id, principal_id). The identified subscription wins: colliding anon rows are dropped.'
  ),
  simpleRepoint(
    'page_views',
    pageViews,
    'principal_id',
    'Visitor analytics soft link (no FK): the lead page-view history follows the identified principal.'
  ),
  simpleRepoint(
    'visitor_devices',
    visitorDevices,
    'principal_id',
    'Durable device mapping soft link (no FK): devices follow the person.'
  ),
  {
    table: 'user_segments',
    columns: ['principal_id'],
    description:
      'Segment memberships; unique (principal_id, segment_id). Explicit rows (manual/sso/widget/api) transfer, collisions drop the anon row, and dynamic rows are deleted because the evaluator rebuilds them from the surviving principal.',
    async run(tx, { from, to }) {
      await tx
        .delete(userSegments)
        .where(
          and(
            eq(userSegments.principalId, from),
            sql`EXISTS (SELECT 1 FROM user_segments t WHERE t.principal_id = ${toUuid(to)} AND t.segment_id = ${userSegments.segmentId})`
          )
        )
      await tx
        .update(userSegments)
        .set({ principalId: to })
        .where(and(eq(userSegments.principalId, from), ne(userSegments.addedBy, 'dynamic')))
      await tx.delete(userSegments).where(eq(userSegments.principalId, from))
    },
  },
  collisionRepoint(
    'kb_article_feedback',
    helpCenterArticleFeedback,
    'principal_id',
    ['article_id'],
    'Help-center article feedback; unique (article_id, principal_id). The identified vote wins: colliding anon rows are dropped.'
  ),
  {
    table: 'principal',
    columns: ['contact_email'],
    description:
      'Attribute consolidation, not a re-point: contact_email fills the target only when the target has none (user wins, lead fills gaps).',
    async run(tx, { from, to }) {
      // Single conditional UPDATE: the SET pulls the source email via a
      // correlated subquery, and the IS NULL guard in the WHERE enforces
      // fill-if-empty (a populated target matches zero rows). A source with
      // no contact_email writes NULL over the target's NULL — a no-op.
      await tx
        .update(principal)
        .set({
          contactEmail: sql`(SELECT source.contact_email FROM principal source WHERE source.id = ${toUuid(from)})`,
        })
        .where(and(eq(principal.id, to), isNull(principal.contactEmail)))
    },
  },
]

/**
 * Tables/columns that reference principals but deliberately have no re-point
 * step. Keyed `table.column`; the completeness test fails on any reference
 * that is neither here nor covered by a step, and on stale entries.
 *
 * The recurring rationale: merge direction is strictly anonymous-to-identified,
 * so columns only team, agent, or service principals can occupy never hold the
 * merge source.
 */
export const REPOINT_EXEMPTIONS: Record<string, string> = {
  // Team/agent actor columns (anonymous principals can never occupy them)
  'posts.owner_principal_id': 'post owners are team members; the merge source is always anonymous',
  'posts.tracked_by_principal_id': 'tracking actor is a team member',
  'posts.deleted_by_principal_id': 'moderation actor is a team member',
  'posts.merged_by_principal_id': 'post-merge actor is a team member',
  'post_votes.added_by_principal_id': 'proxy-vote actor is a team member',
  'post_comments.deleted_by_principal_id': 'moderation actor is a team member',
  'post_notes.principal_id': 'internal staff notes; authors are team members',
  'post_mentions.principal_id': 'mention targets are team members',
  'conversations.assigned_agent_principal_id': 'agents are never anonymous',
  'conversation_messages.deleted_by_principal_id': 'message moderation is agent-only',
  'conversation_message_mentions.principal_id': 'conversation mentions target agents',
  'conversation_message_reactions.principal_id':
    'conversation reactions are agent-only (requireAgent)',
  'conversation_message_flags.principal_id': 'message flags are agent-only',
  'kb_articles.principal_id': 'help-center authors are team members',
  'changelog_entries.principal_id': 'changelog authors are team members',
  'post_merge_suggestions.resolved_by_principal_id': 'suggestion resolution is a team action',
  'feedback_suggestions.resolved_by_principal_id': 'suggestion resolution is a team action',
  'principal_role_assignments.principal_id':
    'role assignments are team-only; anonymous principals hold none',
  'principal_role_assignments.granted_by_principal_id': 'grant actor is a team member',
  'push_devices.principal_id': 'push devices belong to agents',
  // Service-principal identity columns
  'api_keys.principal_id': 'API keys are backed by service principals',
  'api_keys.created_by_id': 'key creator is a team member',
  'webhooks.created_by_id': 'webhook creator is a team member',
  'integrations.principal_id': 'integration identity is a service principal',
  'integrations.connected_by_principal_id': 'integration connector is a team member',
  'integration_platform_credentials.configured_by_principal_id':
    'credential configurator is a team member',
  // Import/pipeline attribution (identified or service principals only)
  'raw_feedback_items.principal_id':
    'pipeline attribution comes from import/integration actors, never anonymous visitors',
  'external_user_mappings.principal_id':
    'external identities map to identified principals created by import; the merge source is always anonymous',
  // Derived state that is recreated on demand; deleting with the anon identity is intended
  'notification_preferences.principal_id':
    'derived preference state; cascades with the anon principal by design (target keeps its own)',
  'unsubscribe_tokens.principal_id':
    'derived token state; cascades with the anon principal by design',
}

/**
 * Move every piece of activity owned by `from` onto `to`, inside the caller's
 * transaction. Runs the ordered registry; does NOT delete the source identity
 * (that is the factory's deleteAnonymousIdentity, called by the orchestrators
 * after this returns).
 */
export async function repointPrincipalActivity(
  tx: Transaction,
  from: PrincipalId,
  to: PrincipalId,
  options: RepointOptions = {}
): Promise<void> {
  const ctx: RepointContext = { from, to, ...options }
  for (const step of REPOINT_STEPS) {
    await step.run(tx, ctx)
  }
}
