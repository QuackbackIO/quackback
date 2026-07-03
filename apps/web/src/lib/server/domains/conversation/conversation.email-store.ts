/**
 * Persistence for the email channel: the outbound Message-ID -> conversation
 * map that powers reply threading, and the channel-identity map that resolves a
 * sender address to a known principal (support-platform cold inbound). Kept
 * apart from the pure parsing/addressing helpers so those stay dependency-free.
 */
import {
  db,
  and,
  eq,
  inArray,
  desc,
  sql,
  channelIdentities,
  conversationOutboundEmails,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { stripAngleBrackets } from './conversation.email-inbound'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-email-store' })

const EMAIL_CHANNEL = 'email'

/** Normalize a Message-ID to the stored form: strip angle brackets, lower-case. */
function normalizeMessageId(id: string): string {
  return stripAngleBrackets(id).toLowerCase()
}

/**
 * Record a Message-ID we stamped on an outbound conversation email so a later
 * reply that dropped the plus-address can still be routed back (and so the next
 * outbound mail can build its References chain). Idempotent; never throws — a
 * threading-map miss only costs the References fallback, never correctness.
 */
export async function recordOutboundEmail(
  messageId: string,
  conversationId: ConversationId
): Promise<void> {
  try {
    await db
      .insert(conversationOutboundEmails)
      .values({ messageId: normalizeMessageId(messageId), conversationId })
      .onConflictDoNothing()
  } catch (err) {
    log.warn({ err }, 'failed to record outbound email message-id')
  }
}

/** Prior outbound Message-IDs for a conversation, oldest first — the References
 *  chain for the next outbound mail. Bounded so a long thread stays cheap. */
export async function priorOutboundMessageIds(
  conversationId: ConversationId,
  limit = 20
): Promise<string[]> {
  const rows = await db
    .select({ messageId: conversationOutboundEmails.messageId })
    .from(conversationOutboundEmails)
    .where(eq(conversationOutboundEmails.conversationId, conversationId))
    .orderBy(desc(conversationOutboundEmails.createdAt))
    .limit(limit)
  // Fetched newest-first for the LIMIT; return oldest-first for the header.
  return rows.map((r) => r.messageId).reverse()
}

/**
 * Resolve the conversation an inbound reply belongs to by matching any of its
 * In-Reply-To / References Message-IDs against our stored outbound ids. The
 * deterministic-Message-ID fallback for replies whose client stripped the
 * plus-address. Returns null when none match.
 */
export async function resolveConversationByMessageIds(
  candidates: string[]
): Promise<ConversationId | null> {
  const normalized = [...new Set(candidates.map(normalizeMessageId).filter(Boolean))]
  if (normalized.length === 0) return null
  const rows = await db
    .select({ conversationId: conversationOutboundEmails.conversationId })
    .from(conversationOutboundEmails)
    .where(inArray(conversationOutboundEmails.messageId, normalized))
    .limit(1)
  return (rows[0]?.conversationId as ConversationId | undefined) ?? null
}

/** Resolve a sender email to the principal that owns it, or null. */
export async function resolvePrincipalIdByEmail(email: string): Promise<PrincipalId | null> {
  const rows = await db
    .select({ principalId: channelIdentities.principalId })
    .from(channelIdentities)
    .where(
      and(
        eq(channelIdentities.channel, EMAIL_CHANNEL),
        eq(channelIdentities.externalId, email.toLowerCase())
      )
    )
    .limit(1)
  return (rows[0]?.principalId as PrincipalId | undefined) ?? null
}

/**
 * Record that an email address belongs to a principal. `verified` is true only
 * when the association was cryptographically proven (a verified identify);
 * observed associations (we sent mail to it) stay false. Idempotent on the
 * (channel, external_id) key; the only field an existing row takes on conflict is
 * a ONE-WAY verified upgrade (`existing OR incoming`) — a later verified write
 * promotes an observed row, and an observed write never demotes a verified one.
 * Never throws.
 */
export async function recordEmailIdentity(
  email: string,
  principalId: PrincipalId,
  verified = false
): Promise<void> {
  try {
    await db
      .insert(channelIdentities)
      .values({ channel: EMAIL_CHANNEL, externalId: email.toLowerCase(), principalId, verified })
      .onConflictDoUpdate({
        target: [channelIdentities.channel, channelIdentities.externalId],
        set: { verified: sql`${channelIdentities.verified} OR excluded.verified` },
      })
  } catch (err) {
    log.warn({ err }, 'failed to record channel identity')
  }
}
