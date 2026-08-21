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
  isNull,
  sql,
  channelIdentities,
  conversationMessages,
  conversationOutboundEmails,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { sesBareMessageId } from '@quackback/email/message-id'
import { stripAngleBrackets } from './conversation.email-inbound'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-email-store' })

const EMAIL_CHANNEL = 'email'

/** True when the stored inbound id is an RFC 5322 msg-id, not a transport dedupe key. */
function isRfcMessageId(id: string): boolean {
  return id.includes('@') && !id.toLowerCase().startsWith('qb-transport:')
}

/** Normalize a Message-ID to the stored form: strip angle brackets, lower-case. */
function normalizeMessageId(id: string): string {
  return stripAngleBrackets(id).toLowerCase()
}

/**
 * Every stored form a quoted Message-ID could have been written in.
 *
 * Normally one: the id exactly as quoted. The exception is the sending provider
 * that assigns its own id — its API reports that id bare while its header
 * carries the same id at a regional host, so the row holds one form and the
 * reply quotes the other. The local part is offered as a second candidate to
 * span that gap, and this is the mechanism the route home rests on: nothing
 * anywhere stores a host that was inferred rather than observed, so no reply is
 * ever lost to a guess about one.
 *
 * Deliberately narrow, and not a general "match on the local part" rule. The
 * extra candidate is only produced for an id whose host is the PROVIDER's and
 * which carries exactly one `@`, so the local part offered is a whole
 * provider-assigned id rather than a fragment of some longer one. Ids we mint
 * keep their host, so no workspace's id loses the domain that distinguishes it
 * from another's. Both candidates are still exact equality against a row this
 * workspace recorded itself, so nothing here widens what can match.
 *
 * The vocabulary of provider hosts is not restated here: it lives in one module
 * that the transport composing those hosts imports too, so a change to either
 * side cannot silently leave the other behind.
 */
function storedFormsOf(id: string): string[] {
  const normalized = normalizeMessageId(id)
  if (!normalized) return []
  const bare = sesBareMessageId(normalized)
  return bare ? [normalized, bare] : [normalized]
}

/**
 * Record the Message-ID an outbound conversation email actually went out with
 * so a later reply that dropped the plus-address can still be routed back (and
 * so the next outbound mail can build its References chain). Idempotent; never
 * throws — a threading-map miss only costs the References fallback, never
 * correctness.
 *
 * The caller decides WHICH id that is: the one we minted on a transport that
 * lets us set the header, the one the provider reported on a transport that
 * does not. Stored exactly as reported, never adjusted towards the form a reply
 * is expected to quote — that would put a guess in the column the route home
 * compares against, and {@link storedFormsOf} reconciles the two forms at read
 * time instead, where being wrong costs nothing.
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

/**
 * Customer's inbound Message-IDs on this conversation (`metadata.emailMessageId`),
 * oldest first. Used so outbound In-Reply-To / References name the mail they
 * sent, not only the ones we sent.
 */
export async function priorInboundEmailMessageIds(
  conversationId: ConversationId,
  limit = 20
): Promise<string[]> {
  const rows = await db
    .select({
      messageId: sql<string>`${conversationMessages.metadata} ->> 'emailMessageId'`,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        sql`${conversationMessages.metadata} ->> 'emailMessageId' IS NOT NULL`
      )
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit)
  return rows
    .map((r) => r.messageId)
    .filter((id): id is string => typeof id === 'string' && isRfcMessageId(id))
    .reverse()
}

function asTime(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

/**
 * Outbound + inbound Message-IDs for the next visitor-facing mail, merged
 * oldest-first by `created_at` so References is a real chronological chain.
 */
export async function threadIdsForOutbound(
  conversationId: ConversationId,
  limit = 20
): Promise<{ inbound: string[]; outbound: string[]; merged: string[] }> {
  const outboundRows = await db
    .select({
      messageId: conversationOutboundEmails.messageId,
      createdAt: conversationOutboundEmails.createdAt,
    })
    .from(conversationOutboundEmails)
    .where(eq(conversationOutboundEmails.conversationId, conversationId))
    .orderBy(desc(conversationOutboundEmails.createdAt))
    .limit(limit)

  const inboundRows = await db
    .select({
      messageId: sql<string>`${conversationMessages.metadata} ->> 'emailMessageId'`,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        sql`${conversationMessages.metadata} ->> 'emailMessageId' IS NOT NULL`
      )
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit)

  const outbound = outboundRows.map((r) => r.messageId).reverse()
  const inbound = inboundRows
    .map((r) => r.messageId)
    .filter((id): id is string => typeof id === 'string' && isRfcMessageId(id))
    .reverse()

  const merged = [
    ...outboundRows.map((r) => ({
      messageId: r.messageId,
      createdAt: r.createdAt,
    })),
    ...inboundRows.flatMap((r) =>
      r.messageId && isRfcMessageId(r.messageId)
        ? [{ messageId: r.messageId, createdAt: r.createdAt }]
        : []
    ),
  ]
    .sort((a, b) => asTime(a.createdAt) - asTime(b.createdAt))
    .map((r) => r.messageId)

  return { inbound, outbound, merged: [...new Set(merged)] }
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
  const normalized = [...new Set(candidates.flatMap(storedFormsOf))]
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
