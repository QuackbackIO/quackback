/**
 * The author's window to edit or delete their own post.
 *
 * A customer may edit or delete a post they wrote until the team acts on it,
 * and once the team has acted the window stays closed for good (undoing the
 * action does not reopen it). The team acts when it:
 *   - moves the post off the default status,
 *   - replies on it (a public comment from a teammate or an API key; a private
 *     team note does not count, and does not reveal itself here), or
 *   - merges it into another post, or merges another post into it.
 *
 * Nothing a customer does closes the window: the author's own auto-vote, other
 * customers' votes and other customers' comments all leave it open. The two
 * portal switches `allowEditAfterEngagement` / `allowDeleteAfterEngagement`
 * keep it open for good.
 *
 * Every entry point (the permission reads the portal menu shows, and the
 * writes) asks here, so the rule lives once.
 */
import {
  db,
  posts,
  postComments,
  postActivity,
  eq,
  and,
  inArray,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { PostId, PostStatusId } from '@quackback/ids'
import type { PortalConfig } from '@/lib/server/domains/settings'
import type { PermissionCheckResult } from './post.types'

type DbOrTx = Database | Transaction

/** How the team acted on a post, which ends its author's window. */
export type TeamAction = 'status' | 'reply' | 'merge'

/** The facts the window reads from the post row itself. */
export interface AuthorWindowPost {
  id: PostId
  statusId: PostStatusId | null
  /** Whether the post's status is the workspace default (true when it has none). */
  onDefaultStatus: boolean
  canonicalPostId: PostId | null
}

/** Activity types that record the team acting on a post, and what each one means. */
const TEAM_ACTIVITY: Record<string, TeamAction> = {
  'status.changed': 'status',
  'post.merged_in': 'merge',
  'post.merged_away': 'merge',
}

/**
 * Whether the team has ever acted on the post, and how; null while it never
 * has. Once the team acts the window stays closed: moving the post back to the
 * default status, deleting the team's reply, or unmerging does not reopen it.
 * So this reads the history, not only the current state:
 *   - the post's activity log (every status change and merge is recorded),
 *   - every public team reply, soft-deleted ones included,
 *   - and the current state, for anything older than the log.
 *
 * `executor` lets a write run the check on its own transaction, after it has
 * locked the post row.
 */
export async function teamActionOn(
  post: AuthorWindowPost,
  executor: DbOrTx = db
): Promise<TeamAction | null> {
  if (post.statusId && !post.onDefaultStatus) return 'status'
  if (post.canonicalPostId) return 'merge'
  const [history, reply, mergedIn] = await Promise.all([
    executor
      .select({ type: postActivity.type })
      .from(postActivity)
      .where(
        and(
          eq(postActivity.postId, post.id),
          inArray(postActivity.type, Object.keys(TEAM_ACTIVITY))
        )
      )
      .limit(1),
    executor
      .select({ id: postComments.id })
      .from(postComments)
      .where(
        and(
          eq(postComments.postId, post.id),
          eq(postComments.isTeamMember, true),
          eq(postComments.isPrivate, false)
        )
      )
      .limit(1),
    executor
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.canonicalPostId, post.id))
      .limit(1),
  ])
  if (history.length > 0) return TEAM_ACTIVITY[history[0].type] ?? 'status'
  if (reply.length > 0) return 'reply'
  if (mergedIn.length > 0) return 'merge'
  return null
}

const REASONS: Record<'edit' | 'delete', Record<TeamAction, string>> = {
  edit: {
    status: 'Cannot edit posts that have been reviewed by the team',
    reply: 'Cannot edit posts the team has replied to',
    merge: 'Cannot edit posts that have been merged',
  },
  delete: {
    status: 'Cannot delete posts that have been reviewed by the team',
    reply: 'Cannot delete posts the team has replied to',
    merge: 'Cannot delete posts that have been merged',
  },
}

/** Whether the workspace keeps the author's window open after the team acts. */
function alwaysOpen(action: 'edit' | 'delete', config: PortalConfig): boolean {
  return action === 'edit'
    ? config.features.allowEditAfterEngagement === true
    : config.features.allowDeleteAfterEngagement === true
}

/**
 * The author's own edit and delete rights on `post`, given the team action
 * already looked up (so one read serves both answers).
 */
export function authorWindowResult(
  action: 'edit' | 'delete',
  teamAction: TeamAction | null,
  config: PortalConfig
): PermissionCheckResult {
  if (!teamAction || alwaysOpen(action, config)) return { allowed: true }
  return { allowed: false, reason: REASONS[action][teamAction] }
}

/** The author's right to `action` their own post. Looks up the team action itself. */
export async function authorWindow(
  action: 'edit' | 'delete',
  post: AuthorWindowPost,
  config: PortalConfig,
  executor: DbOrTx = db
): Promise<PermissionCheckResult> {
  if (alwaysOpen(action, config)) return { allowed: true }
  return authorWindowResult(action, await teamActionOn(post, executor), config)
}
