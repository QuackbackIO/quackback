/* eslint-disable max-lines -- updatePost handles all side-effects (status, tags, owner, mentions)
 * in one function to avoid multiple DB round-trips; extraction would complicate transaction
 * semantics. announcePublishedPost was already split to post.announce.ts. */

/**
 * Post Service - Core CRUD operations
 *
 * This service handles basic post operations:
 * - Post creation and updates
 * - Post retrieval by ID
 *
 * For other operations, see:
 * - post.voting.ts - Vote operations
 * - post.status.ts - Status changes
 * - post.query.ts - Complex queries (inbox, export)
 * - post.permissions.ts - User edit/delete permissions
 */

import {
  db,
  and,
  boards,
  eq,
  inArray,
  postStatuses,
  posts,
  postTagAssignments,
  postTags,
  postVotes,
  principal as principalTable,
  type Post,
} from '@/lib/server/db'
import { sql, isNull } from 'drizzle-orm'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { enforceCountLimit } from '@/lib/server/domains/settings/tier-enforce'
import { createId } from '@quackback/ids'
import { type PostId, type PrincipalId, type UserId, type PostTagId } from '@quackback/ids'
import {
  dispatchPostStatusChanged,
  dispatchPostUpdated,
  buildEventActor,
} from '@/lib/server/events/dispatch'
import { announcePublishedPost } from './post.announce'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { recordAuditEvent } from '@/lib/server/audit/log'
import { markdownToTiptapJson, contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import { subscribeToPost } from '@/lib/server/domains/subscriptions/subscription.service'
import type { CreatePostInput, UpdatePostInput, CreatePostResult } from './post.types'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import { canCreatePost, ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
import { startOfUtcMonth } from '@/lib/shared/utils/date'
import { extractMentions, extractMentionExcerpts } from './extract-mentions'
import { syncPostMentions } from './sync-post-mentions'
import { buildPostUrl } from '@/lib/server/integrations/message-utils'
import { getBaseUrl } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'posts' })

/**
 * Create a new post
 *
 * Validates that:
 * - Board exists and belongs to the organization
 * - User has permission to create posts
 * - Input data is valid
 *
 * Dispatches a post.created event for webhooks, Slack, etc.
 *
 * @param input - Post creation data
 * @param author - Author information (principalId, userId, name, email)
 * @returns Result containing the created post or an error
 */
export async function createPost(
  input: CreatePostInput,
  author: {
    principalId: PrincipalId
    userId?: UserId
    name?: string
    email?: string
    displayName?: string
    actor?: Actor
  },
  options?: { skipDispatch?: boolean; headers?: Headers }
): Promise<CreatePostResult> {
  log.info({ board_id: input.boardId }, 'create post')

  // Validate input before the tier gate — invalid input doesn't deserve a
  // count(*) query.
  const title = input.title?.trim()
  const content = input.content?.trim() ?? ''

  if (!title) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must not exceed 200 characters')
  }
  if (content.length > 10000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must not exceed 10,000 characters')
  }

  // Tier-limit gate (no-op in OSS — getTierLimits short-circuits to OSS_TIER_LIMITS
  // which has maxPosts: null, so enforceCountLimit returns immediately).
  const limits = await getTierLimits()
  await enforceCountLimit({
    limit: limits.maxPosts,
    name: 'maxPosts',
    friendly: 'posts',
    currentCount: async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(posts)
        .where(isNull(posts.deletedAt))
      return row?.count ?? 0
    },
  })

  // Validate board exists and get status in parallel.
  // The deletedAt filter here is load-bearing: rehostExternalImages (below) uploads
  // to S3 before the locked recheck inside the transaction. Without this filter, a
  // soft-deleted board would only be rejected AFTER the S3 write, orphaning the
  // uploaded objects.
  const needsDefaultStatus = !input.statusId
  const [board, statusResult] = await Promise.all([
    db.query.boards.findFirst({
      where: and(eq(boards.id, input.boardId), isNull(boards.deletedAt)),
    }),
    needsDefaultStatus
      ? db
          .select()
          .from(postStatuses)
          .where(eq(postStatuses.slug, 'open'))
          .limit(1)
          .then((rows) => rows[0])
      : db.query.postStatuses.findFirst({ where: eq(postStatuses.id, input.statusId!) }),
  ])

  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${input.boardId} not found`)
  }

  // Workspace moderation gate. Submissions matching the configured
  // requireApproval category land in 'pending' instead of 'published'.
  // Team always bypasses.
  const portalConfig = await getPortalConfig()
  const createDecision = canCreatePost(
    author.actor ?? ANONYMOUS_ACTOR,
    { access: board.access },
    portalConfig.moderationDefault.requireApproval
  )
  if (!createDecision.allowed) {
    throw new ValidationError('POST_CREATE_DENIED', createDecision.reason)
  }
  // Provisional — recomputed authoritatively under the board row lock inside
  // the transaction below (closes the TOCTOU across the image-rehost window).
  let moderationState: 'published' | 'pending' = createDecision.requiresApproval
    ? 'pending'
    : 'published'

  // Determine statusId - either from input or use default "open" status
  let statusId = input.statusId
  if (!statusId) {
    if (!statusResult) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Default "open" status not found. Please ensure post statuses are configured for this organization.'
      )
    }
    statusId = statusResult.id
  } else {
    // Validate provided statusId exists
    if (!statusResult) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${input.statusId} not found`)
    }
  }

  // Create post, add tags, and auto-upvote in a single transaction
  const parsedContentJson = input.contentJson ?? markdownToTiptapJson(content)
  const contentJson = await rehostExternalImages(parsedContentJson, {
    contentType: 'post',
    principalId: author.principalId,
  })

  const post = await db.transaction(async (tx) => {
    // Re-fetch the board (with its access matrix) under a row lock to close the
    // TOCTOU between the precheck above and the insert. Two races are covered:
    // (1) an admin soft-deletes the board — the insert would otherwise land the
    // post under a deleted board (no FK violation; only deletedAt is set); and
    // (2) an admin tightens the submit tier or flips moderation while the
    // network-bound rehostExternalImages call above runs. SELECT ... FOR UPDATE
    // serializes board writes for the transaction, so re-running canCreatePost
    // against the locked access is decisive, and moderationState is derived
    // from it rather than the stale precheck.
    const [lockedBoard] = await tx
      .select({ access: boards.access })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), isNull(boards.deletedAt)))
      .for('update')
    if (!lockedBoard) {
      throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${input.boardId} not found`)
    }
    const lockedDecision = canCreatePost(
      author.actor ?? ANONYMOUS_ACTOR,
      { access: lockedBoard.access },
      portalConfig.moderationDefault.requireApproval
    )
    if (!lockedDecision.allowed) {
      throw new ValidationError('POST_CREATE_DENIED', lockedDecision.reason)
    }
    moderationState = lockedDecision.requiresApproval ? 'pending' : 'published'

    const [newPost] = await tx
      .insert(posts)
      .values({
        boardId: input.boardId,
        title,
        // Store the markdown projection of the canonical contentJson so every
        // consumer of the `content` column (webhooks, notifications) sees images.
        content: contentJsonToMarkdown(contentJson, content),
        contentJson,
        statusId,
        principalId: author.principalId,
        widgetMetadata: input.widgetMetadata ?? null,
        trackedByPrincipalId: input.trackedByPrincipalId ?? null,
        voteCount: 1,
        moderationState,
        ...(input.createdAt && { createdAt: input.createdAt }),
      })
      .returning()

    // Add tags if provided
    if (input.tagIds && input.tagIds.length > 0) {
      await tx
        .insert(postTagAssignments)
        .values(input.tagIds.map((tagId) => ({ postId: newPost.id, tagId })))
    }

    // Auto-upvote by the author
    await tx.insert(postVotes).values({
      id: createId('post_vote'),
      postId: newPost.id,
      principalId: author.principalId,
    })

    return newPost
  })

  if (moderationState === 'pending') {
    await recordAuditEvent({
      event: 'post.moderation.held',
      actor: {
        userId: author.userId,
        email: author.email,
        role: author.actor?.role ?? null,
        type: author.actor?.principalType ?? 'anonymous',
      },
      headers: options?.headers,
      target: { type: 'post', id: post.id },
      after: { moderationState: 'pending' },
      metadata: { principalType: author.actor?.principalType ?? 'anonymous' },
    })
  }

  if (!options?.skipDispatch) {
    // Auto-subscribe the author to their own post. Runs even when held for
    // moderation so the author receives notifications on approval/rejection.
    await subscribeToPost(author.principalId, post.id, 'author')

    createActivity({
      postId: post.id,
      principalId: author.principalId,
      type: 'post.created',
      metadata: { boardName: board.name },
    })

    // External dispatch (webhooks, Slack, @-mention emails) is deferred until
    // the post is visible. A held post must not trigger integrations until a
    // moderator approves it — approvePostFn calls announcePublishedPost() then.
    if (moderationState === 'published') {
      await announcePublishedPost(post.id, {
        post: {
          id: post.id,
          title: post.title,
          content: post.content,
          boardId: post.boardId,
          contentJson: post.contentJson,
          voteCount: post.voteCount,
        },
        board: { slug: board.slug, name: board.name },
        author,
      })
    }
  }

  return { ...post, boardSlug: board.slug }
}

/**
 * Update an existing post
 *
 * Validates that:
 * - Post exists and belongs to the organization
 * - Update data is valid
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param id - Post ID to update
 * @param input - Update data
 * @returns Result containing the updated post or an error
 */
export async function updatePost(
  id: PostId,
  input: UpdatePostInput,
  actor: {
    principalId: PrincipalId
    userId?: UserId
    email?: string
    displayName?: string
  }
): Promise<Post> {
  log.info({ post_id: id }, 'update post')
  if (!actor?.principalId) {
    throw new ValidationError('VALIDATION_ERROR', 'Actor principal ID is required for post updates')
  }

  // Get existing post
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, id) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${id} not found`)
  }

  const statusChanged = input.statusId !== undefined && input.statusId !== existingPost.statusId

  // Verify post belongs to this organization (via its board)
  const [board, previousStatus, newStatus] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) }),
    statusChanged && existingPost.statusId
      ? db.query.postStatuses.findFirst({ where: eq(postStatuses.id, existingPost.statusId) })
      : null,
    statusChanged
      ? db.query.postStatuses.findFirst({ where: eq(postStatuses.id, input.statusId!) })
      : null,
  ])

  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${existingPost.boardId} not found`)
  }
  if (statusChanged && !newStatus) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${input.statusId} not found`)
  }

  // Validate input
  if (input.title !== undefined) {
    if (!input.title.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Title cannot be empty')
    }
    if (input.title.length > 200) {
      throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
    }
  }
  if (input.content !== undefined) {
    if (input.content.length > 10000) {
      throw new ValidationError('VALIDATION_ERROR', 'Content must be 10,000 characters or less')
    }
  }

  // Capture current tag IDs before update (for activity diff)
  let currentTagIds: string[] = []
  if (input.tagIds !== undefined) {
    const currentTags = await db
      .select({ tagId: postTagAssignments.tagId })
      .from(postTagAssignments)
      .where(eq(postTagAssignments.postId, id))
    currentTagIds = currentTags.map((t) => t.tagId)
  }

  // Build update data
  const updateData: Partial<Post> = {}
  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.contentJson !== undefined || input.content !== undefined) {
    const parsed = input.contentJson ?? markdownToTiptapJson((input.content ?? '').trim())
    const contentJson = await rehostExternalImages(parsed, {
      contentType: 'post',
      principalId: existingPost.principalId,
    })
    updateData.contentJson = contentJson
    // Every content edit carries `input.content` (the API accepts only markdown;
    // the editor emits markdown alongside contentJson), so the fallback reflects
    // the new doc. `existingPost.content` is only a defensive default for a
    // contentJson-only edit, which no caller makes.
    updateData.content = contentJsonToMarkdown(
      contentJson,
      (input.content ?? existingPost.content).trim()
    )
  }
  if (input.statusId !== undefined) updateData.statusId = input.statusId
  if (input.ownerPrincipalId !== undefined) updateData.ownerPrincipalId = input.ownerPrincipalId
  if (input.eta !== undefined) {
    // ETAs are month-granular; truncate to the first of the UTC month here so
    // the invariant holds no matter which caller supplies the timestamp.
    updateData.eta = input.eta ? startOfUtcMonth(input.eta) : null
  }

  // Update the post only if there's data to update
  let updatedPost: Post
  if (Object.keys(updateData).length > 0) {
    const [result] = await db.update(posts).set(updateData).where(eq(posts.id, id)).returning()
    if (!result) {
      throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${id} not found`)
    }
    updatedPost = result
  } else {
    updatedPost = existingPost
  }

  // Regenerate embedding (and cascade to merge check) if title or content changed
  if (input.title !== undefined || input.content !== undefined) {
    import('@/lib/server/domains/embeddings/embedding.service')
      .then(({ generatePostEmbedding }) =>
        generatePostEmbedding(id, updatedPost.title, updatedPost.content)
      )
      .catch((err) => log.error({ err, post_id: id }, 'embedding regen failed'))
  }

  // Update tags if provided
  if (input.tagIds !== undefined) {
    // Remove all existing tags then add new ones if any
    await db.delete(postTagAssignments).where(eq(postTagAssignments.postId, id))
    if (input.tagIds.length > 0) {
      await db
        .insert(postTagAssignments)
        .values(input.tagIds.map((tagId) => ({ postId: id, tagId })))
    }
  }

  if (statusChanged && newStatus) {
    const previousStatusName = previousStatus?.name ?? 'Open'
    await dispatchPostStatusChanged(
      buildEventActor(actor),
      {
        id: updatedPost.id,
        title: updatedPost.title,
        boardId: board.id,
        boardSlug: board.slug,
      },
      previousStatusName,
      newStatus.name
    )

    createActivity({
      postId: id,
      principalId: actor.principalId,
      type: 'status.changed',
      metadata: {
        fromName: previousStatusName,
        fromColor: previousStatus?.color ?? null,
        toName: newStatus.name,
        // Stable identifier (names are editable) so analytics can match the
        // target status by slug even after a rename.
        toSlug: newStatus.slug,
        toColor: newStatus.color ?? null,
      },
    })
  }

  // Record activity for owner changes
  if (input.ownerPrincipalId !== undefined) {
    const oldOwner = existingPost.ownerPrincipalId
    const newOwner = input.ownerPrincipalId
    if (oldOwner !== newOwner) {
      const resolveName = (pid: PrincipalId) =>
        db.query.principal.findFirst({
          where: eq(principalTable.id, pid),
          columns: { displayName: true },
        })

      if (newOwner) {
        const [ownerRow, prevOwnerRow] = await Promise.all([
          resolveName(newOwner),
          oldOwner ? resolveName(oldOwner) : null,
        ])
        createActivity({
          postId: id,
          principalId: actor.principalId,
          type: 'owner.assigned',
          metadata: {
            ownerName: ownerRow?.displayName ?? null,
            ...(oldOwner ? { previousOwnerName: prevOwnerRow?.displayName ?? null } : {}),
          },
        })
      } else {
        const prevOwnerRow = oldOwner ? await resolveName(oldOwner) : null
        createActivity({
          postId: id,
          principalId: actor.principalId,
          type: 'owner.unassigned',
          metadata: { previousOwnerName: prevOwnerRow?.displayName ?? null },
        })
      }
    }
  }

  // Record activity for tag changes
  if (input.tagIds !== undefined) {
    const newTagIds = input.tagIds.map((t) => String(t))
    const added = newTagIds.filter((t) => !currentTagIds.includes(t))
    const removed = currentTagIds.filter((t) => !newTagIds.includes(t))

    if (added.length > 0 || removed.length > 0) {
      // Resolve all tag names in one query
      const allChangedIds = [...added, ...removed] as PostTagId[]
      const tagRows =
        allChangedIds.length > 0
          ? await db
              .select({ id: postTags.id, name: postTags.name })
              .from(postTags)
              .where(inArray(postTags.id, allChangedIds))
          : []
      const tagNameMap = new Map(tagRows.map((t) => [String(t.id), t.name]))

      if (added.length > 0) {
        createActivity({
          postId: id,
          principalId: actor.principalId,
          type: 'tags.added',
          metadata: { tagNames: added.map((t) => tagNameMap.get(t) ?? 'Unknown') },
        })
      }
      if (removed.length > 0) {
        createActivity({
          postId: id,
          principalId: actor.principalId,
          type: 'tags.removed',
          metadata: { tagNames: removed.map((t) => tagNameMap.get(t) ?? 'Unknown') },
        })
      }
    }
  }

  // Dispatch post.updated for non-status field changes
  const changedFields: string[] = []
  if (input.title !== undefined && input.title.trim() !== existingPost.title)
    changedFields.push('title')
  if (input.content !== undefined && input.content.trim() !== existingPost.content)
    changedFields.push('content')
  if (input.tagIds !== undefined) changedFields.push('tags')
  if (
    input.ownerPrincipalId !== undefined &&
    input.ownerPrincipalId !== existingPost.ownerPrincipalId
  )
    changedFields.push('owner')

  if (changedFields.length > 0) {
    dispatchPostUpdated(
      buildEventActor(actor),
      {
        id: updatedPost.id,
        title: updatedPost.title,
        boardId: board.id,
        boardSlug: board.slug,
      },
      changedFields
    )
  }

  // Reconcile @-mentions whenever the body was touched. We call this even when
  // the new mention set is empty so that mentions removed during an edit get
  // deleted from post_mentions. Skipped when neither content nor contentJson
  // was part of the update — a title-only edit must not clobber existing rows.
  if (input.contentJson !== undefined || input.content !== undefined) {
    const contentJson = updatedPost.contentJson
    await syncPostMentions({
      postId: updatedPost.id,
      postTitle: updatedPost.title,
      postUrl: buildPostUrl(getBaseUrl(), board.slug, updatedPost.id),
      mentionedIds: contentJson ? extractMentions(contentJson) : new Set(),
      excerptByPrincipalId: contentJson ? extractMentionExcerpts(contentJson) : new Map(),
      actor: buildEventActor(actor),
    })
  }

  return updatedPost
}

/**
 * Get a post by ID with details
 *
 * @param postId - Post ID to fetch
 * @returns Result containing the post with details or an error
 */
export async function getPostById(postId: PostId): Promise<Post> {
  // Single query with board relation (validates both exist)
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { board: { columns: { id: true } } },
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Board relation validates post belongs to a valid board
  if (!post.board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${post.boardId} not found`)
  }

  return post
}
