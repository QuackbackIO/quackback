/**
 * Internal feedback capture: the three commands, kept apart on purpose.
 *
 * A support conversation can contain product feedback and an operational
 * problem at once, and recording the feedback must not touch the support
 * issue. So capture, link and publish are three commands rather than one with
 * options:
 *
 * - {@link captureInternalFeedback} writes ONE internal post attributed to the
 *   real customer, with no vote, no subscription, no activity, no
 *   announcement, no webhook and no card in the customer's thread.
 * - {@link linkConversationToPost} attaches a conversation to a post that
 *   already exists, optionally with the customer's own words as private
 *   evidence. It never votes: a link is not an endorsement, and a vote on
 *   somebody's behalf is its own authorized action.
 * - {@link publishCaptureToBoard} is the reviewed, permission-gated move to
 *   the board audience. It takes the reviewed title and body explicitly, so
 *   what becomes visible is what a person read, not whatever the capture
 *   happened to store.
 *
 * ## Why the capture is idempotent on a column
 *
 * The assistant's receipt (assistant_tool_calls, Step 5) already stops a
 * second dispatch: the claim is unique on the logical action key, so a
 * replayed turn never runs the executor twice. What it cannot do is hand back
 * the post. A crash between the post's commit and the receipt's settlement
 * leaves a receipt that reads `in_progress`, with the created post's id
 * nowhere a retry can find it, and the conversion dialog does not go through
 * a receipt at all.
 *
 * So the receipt's OWN action key is persisted on the post as `capture_key`,
 * under a unique index. This is not a second identity: it is the same
 * identity, written at the row the capture creates, which makes the insert
 * itself the idempotent operation. A repeat resolves to the existing post
 * whatever state the receipt is in, and the pre-read below is only the fast
 * path.
 */
import { db, and, eq, posts, postExternalLinks, type PostAudience } from '@/lib/server/db'
import type { BoardId, ConversationId, PostId, PrincipalId } from '@quackback/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { can, canViewPost, type Actor } from '@/lib/server/policy'
import { getBaseUrl } from '@/lib/server/config'
import { recordAuditEvent } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'
import type { PostCaptureProvenance } from '@/lib/shared/db-types'

const log = logger.child({ component: 'post-capture' })

/** The admin URL a teammate opens to read a captured post. */
export function captureSourceUrl(conversationId: ConversationId): string {
  return `${getBaseUrl().replace(/\/$/, '')}/admin/inbox?i=${conversationId}`
}

export type CaptureOutcome = 'captured' | 'already_captured'

export interface CaptureInternalFeedbackInput {
  conversationId: ConversationId
  boardId: BoardId
  title: string
  content?: string
  /**
   * The logical identity of this capture. For an assistant turn this is the
   * receipt's own action key; for a teammate it is the conversation plus a
   * stable discriminator. Two calls carrying the same key are one capture.
   */
  captureKey: string
  /** Who captured it, for the provenance record. */
  kind: PostCaptureProvenance['kind']
  runId?: string | null
  involvementId?: string | null
}

export interface CaptureContext {
  /** The actor the capture is authorized and written as: a teammate, or Quinn. */
  actor: Actor
  /** The principal recorded as having captured it (posts.tracked_by_principal_id). */
  capturedByPrincipalId: PrincipalId
  /**
   * The customer the post is attributed to, derived by the caller from the
   * AUTHORIZED conversation. It is never taken from a tool argument: a
   * customer must not be able to name another customer.
   */
  customerPrincipalId: PrincipalId
}

export interface CaptureResult {
  outcome: CaptureOutcome
  postId: PostId
  title: string
}

/** Find the post a capture key already wrote, if any. */
async function findCapturedPost(captureKey: string): Promise<{ id: PostId; title: string } | null> {
  const [row] = await db
    .select({ id: posts.id, title: posts.title })
    .from(posts)
    .where(eq(posts.captureKey, captureKey))
    .limit(1)
  return row ?? null
}

/** Postgres unique-violation on the capture key index. */
function isCaptureKeyConflict(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  const constraint = (error as { constraint_name?: string; constraint?: string } | null) ?? {}
  return (
    code === '23505' &&
    (constraint.constraint_name === 'posts_capture_key_uidx' ||
      constraint.constraint === 'posts_capture_key_uidx')
  )
}

/**
 * Record one internal feedback post for the conversation's customer.
 *
 * The caller has already authorized the conversation and resolved its
 * customer; this command owns the post, its provenance and its backlink, and
 * nothing else. Repeating it with the same `captureKey` returns the first
 * post.
 */
export async function captureInternalFeedback(
  input: CaptureInternalFeedbackInput,
  ctx: CaptureContext
): Promise<CaptureResult> {
  const title = input.title.trim()
  if (!title) throw new ValidationError('VALIDATION_ERROR', 'A title is required')

  const existing = await findCapturedPost(input.captureKey)
  if (existing) {
    log.debug({ post_id: existing.id }, 'capture already recorded')
    await linkConversationToPost({ conversationId: input.conversationId, postId: existing.id }, ctx)
    return { outcome: 'already_captured', postId: existing.id, title: existing.title }
  }

  const provenance: PostCaptureProvenance = {
    kind: input.kind,
    conversationId: input.conversationId,
    ...(input.involvementId ? { involvementId: input.involvementId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    capturedAt: new Date().toISOString(),
  }

  const { createPost } = await import('./post.service')
  let postId: PostId
  let created = true
  try {
    const post = await createPost(
      {
        boardId: input.boardId,
        title,
        content: input.content,
        // 'internal' is what suppresses the author vote, the subscription, the
        // activity row and the announcement, inside createPost itself.
        audience: 'internal',
        captureKey: input.captureKey,
        captureProvenance: provenance,
        trackedByPrincipalId: ctx.capturedByPrincipalId,
        widgetMetadata: { source: 'live_chat', conversationId: input.conversationId },
      },
      { principalId: ctx.customerPrincipalId, actor: ctx.actor }
    )
    postId = post.id
  } catch (error) {
    // Lost the race to another worker computing the same capture. The unique
    // index is the guarantee; this is where it is collected.
    if (!isCaptureKeyConflict(error)) throw error
    const raced = await findCapturedPost(input.captureKey)
    if (!raced) throw error
    postId = raced.id
    created = false
  }

  await linkConversationToPost({ conversationId: input.conversationId, postId }, ctx)

  log.info({ post_id: postId, created }, 'internal feedback captured')
  return { outcome: created ? 'captured' : 'already_captured', postId, title }
}

export interface LinkConversationInput {
  conversationId: ConversationId
  postId: PostId
  /**
   * The customer's own words, attached as a private (team-only) comment so
   * the original context survives. Only ever private: this is evidence, and
   * the post may be board-visible.
   */
  sourceQuote?: string
  /** The conversation's subject, for the link's display label. */
  displayId?: string | null
}

/**
 * Attach a conversation to an existing post.
 *
 * Deliberately not part of capture, and deliberately without a vote. Linking
 * records that this conversation is evidence for that request; voting on the
 * customer's behalf is a separate authorized action with its own permission,
 * and rolling it into a link would inflate a public count from a private act.
 */
export async function linkConversationToPost(
  input: LinkConversationInput,
  ctx: Pick<CaptureContext, 'actor' | 'capturedByPrincipalId'>
): Promise<void> {
  await db
    .insert(postExternalLinks)
    .values({
      postId: input.postId,
      integrationType: 'live_chat',
      externalId: input.conversationId,
      externalUrl: captureSourceUrl(input.conversationId),
      externalDisplayId: input.displayId ?? null,
    })
    .onConflictDoNothing()

  const quote = input.sourceQuote?.trim()
  if (!quote) return
  const { createComment } = await import('@/lib/server/domains/comments/comment.service')
  await createComment(
    {
      postId: input.postId,
      content: `Tracked from a support conversation:\n\n${quote}`,
      isPrivate: true,
    },
    {
      principalId: ctx.capturedByPrincipalId,
      role: ctx.actor.role as 'admin' | 'member',
    },
    ctx.actor
  )
}

export interface PublishCaptureInput {
  postId: PostId
  /** The reviewed title. Whatever a person read is what becomes visible. */
  title: string
  /** The reviewed body. Empty is allowed: a title may be the whole request. */
  content: string
}

export interface PublishCaptureResult {
  postId: PostId
  audience: PostAudience
  boardSlug: string
}

/**
 * Move a captured post to its board, exposing only the reviewed fields.
 *
 * Title and body are replaced by what the reviewer approved rather than
 * carried over, so a conversation excerpt or a note that found its way into
 * the captured body cannot become board-visible by flipping a column. The
 * private evidence stays where it is: the conversation backlink and any
 * private comment are team-only by their own gates, and neither is copied
 * into the published content.
 *
 * No vote and no subscription are created. The post enters the board with the
 * count it actually has, and the customer is not signed up for updates they
 * never asked for.
 */
export async function publishCaptureToBoard(
  input: PublishCaptureInput,
  actor: Actor
): Promise<PublishCaptureResult> {
  if (!can(actor, PERMISSIONS.POST_APPROVE) || !can(actor, PERMISSIONS.POST_VIEW_PRIVATE)) {
    throw new ForbiddenError('FORBIDDEN', 'You cannot publish a captured post to a board')
  }
  const title = input.title.trim()
  if (!title) throw new ValidationError('VALIDATION_ERROR', 'A title is required')
  if (title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must not exceed 200 characters')
  }
  if (input.content.length > 10000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must not exceed 10,000 characters')
  }

  const { boards } = await import('@/lib/server/db')
  const [row] = await db
    .select({
      id: posts.id,
      audience: posts.audience,
      principalId: posts.principalId,
      moderationState: posts.moderationState,
      boardId: posts.boardId,
      boardSlug: boards.slug,
      boardName: boards.name,
      boardAccess: boards.access,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(eq(posts.id, input.postId))
    .limit(1)
  if (!row) throw new NotFoundError('POST_NOT_FOUND', `Post ${input.postId} not found`)
  if (row.audience !== 'internal') {
    throw new ValidationError('NOT_AN_INTERNAL_POST', 'This post is already on its board')
  }
  // The reviewer must be able to see the board they are publishing onto.
  const view = canViewPost(
    actor,
    { moderationState: row.moderationState, principalId: row.principalId, audience: row.audience },
    { access: row.boardAccess }
  )
  if (!view.allowed) throw new NotFoundError('POST_NOT_FOUND', `Post ${input.postId} not found`)

  const { markdownToTiptapJson } = await import('@/lib/server/markdown-tiptap')
  const [updated] = await db
    .update(posts)
    .set({
      audience: 'board',
      title,
      content: input.content,
      contentJson: markdownToTiptapJson(input.content),
      updatedAt: new Date(),
    })
    // Pin the audience so two reviewers publishing at once settle on one write.
    .where(and(eq(posts.id, input.postId), eq(posts.audience, 'internal')))
    .returning()
  if (!updated) {
    throw new ValidationError('NOT_AN_INTERNAL_POST', 'This post is already on its board')
  }

  await recordAuditEvent({
    event: 'post.capture.published',
    actor: { role: actor.role ?? null, type: actor.principalType },
    target: { type: 'post', id: input.postId },
    before: { audience: 'internal' },
    after: { audience: 'board' },
  })

  // Publication is the announcement. It is the same thing releasing a post
  // from moderation does, and it is the one moment a person decided this
  // record should be visible.
  const { announcePublishedPost } = await import('./post.announce')
  const { loadAuthors } = await import('@/lib/server/domains/principals/principal-display')
  const authors = await loadAuthors([updated.principalId])
  const author = authors.get(updated.principalId)
  await announcePublishedPost(input.postId, {
    post: {
      id: updated.id,
      title: updated.title,
      content: updated.content,
      boardId: updated.boardId,
      contentJson: updated.contentJson,
      voteCount: updated.voteCount,
      audience: updated.audience,
    },
    board: { slug: row.boardSlug, name: row.boardName },
    author: {
      principalId: updated.principalId,
      displayName: author?.displayName ?? undefined,
    },
  })

  log.info({ post_id: input.postId }, 'captured post published to board')
  return { postId: input.postId, audience: 'board', boardSlug: row.boardSlug }
}
