/**
 * Telling the customers who asked for something that it happened
 * (QUINN-PRODUCT P9).
 *
 * The last step of the feedback journey: capture, review, link or publish,
 * actual delivery, then a reviewed update. Every word of that last clause is
 * load-bearing here.
 *
 * ## It is never automatic
 *
 * Nothing in this module is called by a status change, a changelog
 * publication or a capture. A person opens the post, reads who would be
 * written to, writes the message and sends it. A status moving to complete is
 * what makes the action OFFERED, never what makes it happen: "the team shipped
 * it" and "we told the customer" are different facts, and only the second one
 * is a promise.
 *
 * ## Who may be written to
 *
 * A recipient is a conversation linked to this post as evidence, whose
 * customer this workspace can reach and who has not opted out. Three gates,
 * each refused by name so the reviewer sees why a row is not sendable rather
 * than a list that quietly lost people:
 *
 * 1. The post is board visible. An internal capture is the team's record about
 *    a customer and there is nothing about it the customer may be told, so the
 *    whole action is refused rather than filtered per recipient.
 * 2. The customer has a deliverable address, resolved through the shared
 *    contact-recipient class rather than read off a row.
 * 3. Their notification preferences allow a status-change email. A follow-up
 *    is an update about a request, so it rides the preference that exists for
 *    exactly that, and a muted customer stays muted.
 *
 * ## Identity, idempotency and reconciliation
 *
 * One send per post per conversation, ever, claimed through Step 5's receipt
 * service on the action key `followup:<post>:<conversation>`. A reviewer who
 * clicks twice, or two reviewers who both decide to send, produce one email:
 * the second loses the claim and reads the first one's receipt. A send that
 * reached the provider and was never confirmed settles as `unknown` and joins
 * the existing reconciliation queue, because an email nobody can confirm must
 * not be resent to a customer on a guess.
 */
import { db, eq, inArray, conversations, posts, boards } from '@/lib/server/db'
import type { PostId, PrincipalId, ConversationId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'

const log = logger.child({ component: 'post-followup' })

/** The longest reviewed message a follow-up may carry. */
export const MAX_FOLLOWUP_MESSAGE = 2000

/** Why a linked customer cannot be written to. */
export type FollowupBlocker = 'no_address' | 'opted_out' | 'already_sent'

export interface FollowupRecipient {
  conversationId: ConversationId
  subject: string | null
  /** Null when this customer cannot be written to, with `blocked` saying why. */
  email: string | null
  blocked: FollowupBlocker | null
  /** When a follow-up about this post already reached them. */
  sentAt: string | null
}

export interface FollowupAudience {
  /** Whether the post is in a state where telling anyone is even legitimate. */
  sendable: boolean
  /** Why not, when it is not. */
  reason: 'internal_audience' | null
  postTitle: string
  statusLabel: string | null
  recipients: FollowupRecipient[]
}

/**
 * Who a reviewer would be writing to, and what stops each one.
 *
 * A read. It resolves the same things the send resolves, so the list a
 * reviewer approves is the list the send acts on, and a row that became
 * unsendable in between is refused there too rather than silently skipped.
 */
export async function getFollowupAudience(postId: PostId, actor: Actor): Promise<FollowupAudience> {
  if (!can(actor, PERMISSIONS.POST_VIEW_PRIVATE)) {
    throw new ForbiddenError('FORBIDDEN', 'You cannot read this post audience')
  }
  const post = await loadPost(postId)
  if (post.audience !== 'board') {
    return {
      sendable: false,
      reason: 'internal_audience',
      postTitle: post.title,
      statusLabel: null,
      recipients: [],
    }
  }

  const { getLinkedConversationsForPost } =
    await import('@/lib/server/domains/conversation/conversation.query')
  const linked = await getLinkedConversationsForPost(postId)
  if (linked.length === 0) {
    return {
      sendable: true,
      reason: null,
      postTitle: post.title,
      statusLabel: post.statusLabel,
      recipients: [],
    }
  }

  const resolved = await resolveRecipients(
    postId,
    linked.map((row) => row.conversationId)
  )
  return {
    sendable: true,
    reason: null,
    postTitle: post.title,
    statusLabel: post.statusLabel,
    recipients: linked.map((row) => {
      const state = resolved.get(row.conversationId)
      return {
        conversationId: row.conversationId,
        subject: row.subject,
        // `?? 'no_address'` would be wrong here: a reachable recipient has a
        // null blocker, and nullish coalescing would turn that into a refusal.
        email: state && !state.blocked ? state.email : null,
        blocked: state ? state.blocked : 'no_address',
        sentAt: state?.sentAt ?? null,
      }
    }),
  }
}

export interface SendFollowupInput {
  postId: PostId
  message: string
  conversationIds: readonly ConversationId[]
}

export type FollowupSendOutcome = 'sent' | 'already_sent' | 'blocked' | 'failed' | 'unconfirmed'

export interface SendFollowupResult {
  results: Array<{ conversationId: ConversationId; outcome: FollowupSendOutcome }>
}

/**
 * Send the reviewed update to the recipients the reviewer chose.
 *
 * Requires the same permission publication does: deciding what a customer is
 * told about a request is the same class of decision as deciding what becomes
 * board visible in the first place.
 */
export async function sendPostFollowup(
  input: SendFollowupInput,
  actor: Actor
): Promise<SendFollowupResult> {
  if (!can(actor, PERMISSIONS.POST_APPROVE) || !can(actor, PERMISSIONS.POST_VIEW_PRIVATE)) {
    throw new ForbiddenError('FORBIDDEN', 'You cannot send an update about this request')
  }
  const message = input.message.trim()
  if (!message) throw new ValidationError('FOLLOWUP_EMPTY', 'Write the update before sending it')
  if (message.length > MAX_FOLLOWUP_MESSAGE) {
    throw new ValidationError('FOLLOWUP_TOO_LONG', 'That update is too long')
  }
  if (input.conversationIds.length === 0) {
    throw new ValidationError('FOLLOWUP_NO_RECIPIENTS', 'Choose who to tell')
  }

  const post = await loadPost(input.postId)
  if (post.audience !== 'board') {
    throw new ForbiddenError(
      'FOLLOWUP_INTERNAL_POST',
      'Publish this to a board before telling anyone about it'
    )
  }

  const resolved = await resolveRecipients(input.postId, input.conversationIds)
  const results: SendFollowupResult['results'] = []
  for (const conversationId of input.conversationIds) {
    const state = resolved.get(conversationId)
    if (!state || state.blocked === 'no_address' || state.blocked === 'opted_out') {
      results.push({ conversationId, outcome: 'blocked' })
      continue
    }
    if (state.blocked === 'already_sent') {
      results.push({ conversationId, outcome: 'already_sent' })
      continue
    }
    results.push({
      conversationId,
      outcome: await sendOne({ post, message, conversationId, state }),
    })
  }
  log.info(
    {
      event: 'post_followup.sent',
      post_id: input.postId,
      by: actor.principalId,
      outcomes: results.map((row) => row.outcome),
    },
    'reviewed follow-up sent'
  )
  return { results }
}

interface RecipientState {
  principalId: PrincipalId
  email: string | null
  blocked: FollowupBlocker | null
  sentAt: string | null
}

interface FollowupPost {
  id: PostId
  title: string
  audience: string
  boardSlug: string
  statusLabel: string | null
}

async function loadPost(postId: PostId): Promise<FollowupPost> {
  const { postStatuses } = await import('@/lib/server/db')
  const [row] = await db
    .select({
      id: posts.id,
      title: posts.title,
      audience: posts.audience,
      boardSlug: boards.slug,
      statusLabel: postStatuses.name,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .leftJoin(postStatuses, eq(posts.statusId, postStatuses.id))
    .where(eq(posts.id, postId))
    .limit(1)
  if (!row) throw new NotFoundError('POST_NOT_FOUND', 'Post not found')
  return row as FollowupPost
}

/** The stable identity of one follow-up: one post, one customer, once. */
export function followupActionKey(postId: PostId, conversationId: ConversationId): string {
  return `followup:${postId}:${conversationId}`
}

/**
 * Resolve every gate for a set of linked conversations at once.
 *
 * Deliberately one function for the read and the send, so a reviewer cannot
 * approve a list assembled under one set of rules and have it sent under
 * another.
 */
async function resolveRecipients(
  postId: PostId,
  conversationIds: readonly ConversationId[]
): Promise<Map<ConversationId, RecipientState>> {
  const out = new Map<ConversationId, RecipientState>()
  if (conversationIds.length === 0) return out

  const rows = await db
    .select({ id: conversations.id, principalId: conversations.visitorPrincipalId })
    .from(conversations)
    .where(inArray(conversations.id, [...conversationIds]))
  const principalIds = rows.map((row) => row.principalId)

  const [{ resolveContactRecipients }, { batchGetNotificationPreferences }, { shouldNotify }] =
    await Promise.all([
      import('@/lib/server/email/recipient'),
      import('@/lib/server/domains/subscriptions/subscription.service'),
      import('@/lib/server/domains/subscriptions/notification-matrix'),
    ])
  const [addresses, preferences, receipts] = await Promise.all([
    resolveContactRecipients(principalIds),
    batchGetNotificationPreferences(principalIds),
    existingFollowups(postId, conversationIds),
  ])

  for (const row of rows) {
    const sentAt = receipts.get(row.id as ConversationId) ?? null
    const email = addresses.get(row.principalId) ?? null
    const prefs = preferences.get(row.principalId)
    const allowed = prefs ? shouldNotify(prefs, 'post_status_changed', 'email') : true
    out.set(row.id as ConversationId, {
      principalId: row.principalId,
      email,
      sentAt,
      blocked: sentAt ? 'already_sent' : !email ? 'no_address' : !allowed ? 'opted_out' : null,
    })
  }
  return out
}

/** Which of these customers already had a follow-up about this post. */
async function existingFollowups(
  postId: PostId,
  conversationIds: readonly ConversationId[]
): Promise<Map<ConversationId, string>> {
  const { assistantToolCalls } = await import('@/lib/server/db')
  const keys = conversationIds.map((id) => followupActionKey(postId, id))
  const rows = await db
    .select({
      actionKey: assistantToolCalls.actionKey,
      createdAt: assistantToolCalls.createdAt,
      outcomeStatus: assistantToolCalls.outcomeStatus,
    })
    .from(assistantToolCalls)
    .where(inArray(assistantToolCalls.actionKey, keys))
  const out = new Map<ConversationId, string>()
  for (const conversationId of conversationIds) {
    const row = rows.find(
      (candidate) => candidate.actionKey === followupActionKey(postId, conversationId)
    )
    // A failed attempt is not a send: the reviewer may try again. Anything
    // else, including an unconfirmed one, is left alone.
    if (row && row.outcomeStatus !== 'failed') out.set(conversationId, row.createdAt.toISOString())
  }
  return out
}

/** One recipient, claimed and settled through the shared receipt service. */
async function sendOne(input: {
  post: FollowupPost
  message: string
  conversationId: ConversationId
  state: RecipientState
}): Promise<FollowupSendOutcome> {
  const { claimToolCall, markToolCallDispatched, settleToolCall } =
    await import('@/lib/server/domains/assistant/tool-audit')
  const { digestOf } = await import('@/lib/server/domains/assistant/tool-receipts')
  const actionKey = followupActionKey(input.post.id, input.conversationId)
  const args = {
    postId: input.post.id,
    conversationId: input.conversationId,
    message: input.message,
  }
  const claimed = await claimToolCall({
    conversationId: input.conversationId,
    toolName: 'post_followup',
    args,
    idempotencyKey: actionKey,
    actionKey,
    argsDigest: digestOf(args),
    // The effect leaves this database, and no provider offers a status query
    // this code could rely on, so an interrupted send is uncertain by
    // construction and goes to a person rather than being resent.
    replayStrategy: 'external_uncertain',
  })
  // Losing the claim means this identity already has a receipt. A refusal the
  // provider gave before sending anything is the one reading that may be
  // attempted again, under the SAME receipt rather than a second one: every
  // other reading, including an effect nobody could confirm, stays where it
  // is.
  const receipt = claimed ?? (await reclaimFailedReceipt(actionKey))
  if (!receipt) return 'already_sent'

  // The intent commit: stamped BEFORE the provider call, so a crash in the
  // window leaves a row that says attempted and never confirmed.
  await markToolCallDispatched(receipt.id)
  try {
    const sent = await deliver(input)
    if (!sent.sent) {
      await settleToolCall(receipt.id, {
        status: 'failed',
        reason: sent.reason ?? 'The update could not be sent.',
        retryable: true,
      })
      return 'failed'
    }
    await settleToolCall(receipt.id, {
      status: 'succeeded',
      value: { sent: true },
      receiptId: receipt.id,
    })
    return 'sent'
  } catch (err) {
    // Reached the provider, answer unknown. Never resent on a guess.
    await settleToolCall(receipt.id, {
      status: 'unknown',
      receiptId: receipt.id,
      reconciliationRequired: true,
    })
    log.warn(
      { err, post_id: input.post.id, conversation_id: input.conversationId },
      'follow-up send was not confirmed'
    )
    return 'unconfirmed'
  }
}

/**
 * Reopen the receipt of a send the provider refused outright.
 *
 * Returns null for every other state, which is what keeps the identity
 * meaning one send: a succeeded row is done, and an unconfirmed one is a
 * person's to settle.
 */
async function reclaimFailedReceipt(actionKey: string) {
  const { findToolReceipt, finalizeToolCall } =
    await import('@/lib/server/domains/assistant/tool-audit')
  const existing = await findToolReceipt({ actionKey, idempotencyKey: actionKey })
  if (!existing || existing.outcomeStatus !== 'failed') return null
  await finalizeToolCall(existing.id, {
    status: 'started',
    outcomeStatus: null,
    retryable: null,
    error: null,
    settledAt: null,
  })
  return existing
}

async function deliver(input: {
  post: FollowupPost
  message: string
  conversationId: ConversationId
  state: RecipientState
}): Promise<{ sent: boolean; reason?: string }> {
  const { generateUnsubscribeToken } =
    await import('@/lib/server/domains/subscriptions/subscription.service')
  const { buildHookContext } = await import('@/lib/server/events/hook-context')
  const context = await buildHookContext()
  if (!context) return { sent: false, reason: 'This workspace is not configured to send email.' }
  const token = await generateUnsubscribeToken(
    input.state.principalId,
    input.post.id,
    'unsubscribe_post'
  ).catch(() => null)
  const base = context.portalBaseUrl.replace(/\/$/, '')
  const { sendPostUpdateEmail } = await import('@quackback/email')
  const result = await sendPostUpdateEmail({
    to: input.state.email as string,
    postTitle: input.post.title,
    postUrl: `${base}/b/${input.post.boardSlug}/posts/${input.post.id}`,
    message: input.message,
    ...(input.post.statusLabel ? { statusLabel: input.post.statusLabel } : {}),
    workspaceName: context.workspaceName,
    unsubscribeUrl: token ? `${base}/unsubscribe?token=${token}` : `${base}/settings/notifications`,
    ...(context.logoUrl ? { logoUrl: context.logoUrl } : {}),
  })
  return { sent: result.sent !== false, reason: 'reason' in result ? result.reason : undefined }
}
