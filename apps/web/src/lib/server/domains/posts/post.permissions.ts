/**
 * Post Permissions Service
 *
 * Handles user permission checks for editing and deleting their own posts.
 * Write operations (userEditPost, softDeletePost, restorePost, permanentDeletePost)
 * live in post.user-actions.ts. The author's window itself (until the team
 * acts on the post) lives in post.author-window.ts, shared by both.
 */

import { db, posts, eq } from '@/lib/server/db'
import type { PostId, PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { isTeamMember, Role } from '@/lib/shared/roles'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/server/domains/settings'
import type { PermissionCheckResult } from './post.types'
import {
  authorWindow,
  authorWindowResult,
  teamActionOn,
  type AuthorWindowPost,
} from './post.author-window'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'post-permissions' })

type Actor = { principalId: PrincipalId; role: Role }

/** The post row with what the author window and these checks read. */
async function loadPost(postId: PostId) {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { postStatus: { columns: { isDefault: true } } },
  })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }
  return post
}

function windowPost(post: Awaited<ReturnType<typeof loadPost>>): AuthorWindowPost {
  return {
    id: post.id as PostId,
    statusId: post.statusId,
    // No status, or the default one.
    onDefaultStatus: !post.statusId || post.postStatus?.isDefault === true,
    canonicalPostId: post.canonicalPostId as PostId | null,
  }
}

// ============================================================================
// Permission Checks
// ============================================================================

/**
 * Check if a user can edit a post: team members always can; the author can
 * until the team acts on it.
 */
export async function canEditPost(
  postId: PostId,
  actor: Actor,
  portalConfig?: PortalConfig
): Promise<PermissionCheckResult> {
  log.debug(
    { post_id: postId, principal_id: actor.principalId, role: actor.role },
    'can edit post check'
  )
  const post = await loadPost(postId)
  if (post.deletedAt) return { allowed: false, reason: 'Cannot edit a deleted post' }
  if (isTeamMember(actor.role)) return { allowed: true }
  if (post.principalId !== actor.principalId) {
    return { allowed: false, reason: 'You can only edit your own posts' }
  }
  return authorWindow('edit', windowPost(post), portalConfig ?? (await getPortalConfig()))
}

/**
 * Check if a user can delete a post: team members always can; the author can
 * until the team acts on it.
 */
export async function canDeletePost(
  postId: PostId,
  actor: Actor,
  portalConfig?: PortalConfig
): Promise<PermissionCheckResult> {
  log.debug(
    { post_id: postId, principal_id: actor.principalId, role: actor.role },
    'can delete post check'
  )
  const post = await loadPost(postId)
  if (post.deletedAt) return { allowed: false, reason: 'Post has already been deleted' }
  if (isTeamMember(actor.role)) return { allowed: true }
  if (post.principalId !== actor.principalId) {
    return { allowed: false, reason: 'You can only delete your own posts' }
  }
  return authorWindow('delete', windowPost(post), portalConfig ?? (await getPortalConfig()))
}

/**
 * Both checks at once, reading the post, the portal config and the team's
 * actions once. What the portal's post menu shows.
 */
export async function getPostPermissions(
  postId: PostId,
  actor: Actor
): Promise<{
  canEdit: PermissionCheckResult
  canDelete: PermissionCheckResult
}> {
  log.debug(
    { post_id: postId, principal_id: actor.principalId, role: actor.role },
    'get post permissions'
  )
  const post = await loadPost(postId)

  if (post.deletedAt) {
    return {
      canEdit: { allowed: false, reason: 'Cannot edit a deleted post' },
      canDelete: { allowed: false, reason: 'Post has already been deleted' },
    }
  }

  if (isTeamMember(actor.role)) {
    return { canEdit: { allowed: true }, canDelete: { allowed: true } }
  }

  if (post.principalId !== actor.principalId) {
    return {
      canEdit: { allowed: false, reason: 'You can only edit your own posts' },
      canDelete: { allowed: false, reason: 'You can only delete your own posts' },
    }
  }

  const [config, teamAction] = await Promise.all([
    getPortalConfig(),
    teamActionOn(windowPost(post)),
  ])
  return {
    canEdit: authorWindowResult('edit', teamAction, config),
    canDelete: authorWindowResult('delete', teamAction, config),
  }
}

// ============================================================================
// Helper Methods
// ============================================================================

/**
 * Get portal config (single workspace mode - returns global config)
 */
async function getPortalConfig(): Promise<PortalConfig> {
  // Get the global settings config
  const org = await db.query.settings.findFirst()

  if (!org?.portalConfig) {
    return DEFAULT_PORTAL_CONFIG
  }

  // Parse the JSON string from database
  let config: Partial<PortalConfig>
  try {
    config = JSON.parse(org.portalConfig) as Partial<PortalConfig>
  } catch {
    return DEFAULT_PORTAL_CONFIG
  }

  // Merge with defaults to ensure all fields exist
  return {
    ...DEFAULT_PORTAL_CONFIG,
    ...config,
    features: {
      ...DEFAULT_PORTAL_CONFIG.features,
      ...(config?.features ?? {}),
    },
  }
}
