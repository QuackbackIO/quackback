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
  postStatuses,
  posts,
  postTags,
  type Post,
  type TiptapContent,
} from '@/lib/server/db'
import { type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { dispatchPostCreated, buildEventActor } from '@/lib/server/events/dispatch'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { subscribeToPost } from '@/lib/server/domains/subscriptions/subscription.service'
import type { CreatePostInput, UpdatePostInput, CreatePostResult } from './post.types'

/** Convert plain text to TipTap JSON when contentJson is not provided */
function plainTextToTipTap(text: string): TiptapContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
}

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
  }
): Promise<CreatePostResult> {
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
      contentJson: input.contentJson ?? plainTextToTipTap(content),
      statusId,
      principalId: author.principalId,
    })
    .returning()

  // Add tags if provided
  if (input.tagIds && input.tagIds.length > 0) {
    // Remove all existing tags then add new ones
    await db.delete(postTags).where(eq(postTags.postId, post.id))
    await db.insert(postTags).values(input.tagIds.map((tagId) => ({ postId: post.id, tagId })))
  }

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
export async function updatePost(id: PostId, input: UpdatePostInput): Promise<Post> {
  // Get existing post
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, id) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${id} not found`)
  }

  // Verify post belongs to this organization (via its board)
  const board = await db.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${existingPost.boardId} not found`)
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

  // Build update data
  const updateData: Partial<Post> = {}
  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.content !== undefined) updateData.content = input.content.trim()
  if (input.contentJson !== undefined) updateData.contentJson = input.contentJson
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

  // Update tags if provided
  if (input.tagIds !== undefined) {
    // Remove all existing tags then add new ones if any
    await db.delete(postTags).where(eq(postTags.postId, id))
    if (input.tagIds.length > 0) {
      await db.insert(postTags).values(input.tagIds.map((tagId) => ({ postId: id, tagId })))
    }
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
