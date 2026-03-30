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
  boards,
  eq,
  inArray,
  postStatuses,
  posts,
  postTags,
  tags,
  principal as principalTable,
  type Post,
} from '@/lib/server/db'
import { type PostId, type PrincipalId, type UserId, type TagId } from '@featurepool/ids'
import {
  dispatchPostCreated,
  dispatchPostStatusChanged,
  dispatchPostUpdated,
  buildEventActor,
} from '@/lib/server/events/dispatch'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { subscribeToPost } from '@/lib/server/domains/subscriptions/subscription.service'
import type { CreatePostInput, UpdatePostInput, CreatePostResult } from './post.types'
import { createActivity } from '@/lib/server/domains/activity/activity.service'

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
  },
  options?: { skipDispatch?: boolean }
): Promise<CreatePostResult> {
  console.log(`[domain:posts] createPost: boardId=${input.boardId}`)
  // Basic validation (also done at action layer, but enforced here for direct service calls)
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

  // Validate board exists and get status in parallel
  const needsDefaultStatus = !input.statusId
  const [board, statusResult] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, input.boardId) }),
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

  // Create the post with member-scoped identity
  const [post] = await db
    .insert(posts)
    .values({
      boardId: input.boardId,
      title,
      content,
      contentJson: input.contentJson ?? markdownToTiptapJson(content),
      statusId,
      principalId: author.principalId,
      widgetMetadata: input.widgetMetadata ?? null,
      ...(input.createdAt && { createdAt: input.createdAt }),
    })
    .returning()

  // Add tags if provided
  if (input.tagIds && input.tagIds.length > 0) {
    // Remove all existing tags then add new ones
    await db.delete(postTags).where(eq(postTags.postId, post.id))
    await db.insert(postTags).values(input.tagIds.map((tagId) => ({ postId: post.id, tagId })))
  }

  if (!options?.skipDispatch) {
    // Auto-subscribe the author to their own post
    await subscribeToPost(author.principalId, post.id, 'author')

    // Dispatch post.created event for webhooks, Slack, AI processing, etc.
    const actorName = author.displayName ?? author.name
    await dispatchPostCreated(buildEventActor(author), {
      id: post.id,
      title: post.title,
      content: post.content,
      boardId: post.boardId,
      boardSlug: board.slug,
      authorEmail: author.email,
      authorName: actorName,
      voteCount: post.voteCount,
    })

    createActivity({
      postId: post.id,
      principalId: author.principalId,
      type: 'post.created',
      metadata: { boardName: board.name },
    })
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
  console.log(`[domain:posts] updatePost: id=${id}`)
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
      : Promise.resolve(null),
    statusChanged
      ? db.query.postStatuses.findFirst({ where: eq(postStatuses.id, input.statusId!) })
      : Promise.resolve(null),
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
      .select({ tagId: postTags.tagId })
      .from(postTags)
      .where(eq(postTags.postId, id))
    currentTagIds = currentTags.map((t) => t.tagId)
  }

  // Build update data
  const updateData: Partial<Post> = {}
  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.content !== undefined) updateData.content = input.content.trim()
  if (input.contentJson !== undefined) {
    updateData.contentJson = input.contentJson
  } else if (input.content !== undefined) {
    // Derive contentJson from markdown when only content is provided (MCP/API path)
    updateData.contentJson = markdownToTiptapJson(input.content.trim())
  }
  if (input.statusId !== undefined) updateData.statusId = input.statusId
  if (input.ownerPrincipalId !== undefined) updateData.ownerPrincipalId = input.ownerPrincipalId

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
      .catch((err) => console.error(`[domain:posts] Embedding regen failed for ${id}:`, err))
  }

  // Update tags if provided
  if (input.tagIds !== undefined) {
    // Remove all existing tags then add new ones if any
    await db.delete(postTags).where(eq(postTags.postId, id))
    if (input.tagIds.length > 0) {
      await db.insert(postTags).values(input.tagIds.map((tagId) => ({ postId: id, tagId })))
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
      const allChangedIds = [...added, ...removed] as TagId[]
      const tagRows =
        allChangedIds.length > 0
          ? await db
              .select({ id: tags.id, name: tags.name })
              .from(tags)
              .where(inArray(tags.id, allChangedIds))
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
