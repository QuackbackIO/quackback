/**
 * Cold-inbound sender resolution (support platform §4.8 Layer 2). When an email
 * arrives that isn't a reply to an existing conversation, this decides WHO it is
 * from, gated by the DMARC trust verdict and the decided identity model
 * (IDENTITY-MODEL-ANALYSIS.md): inbound email attaches by address only under a
 * DMARC pass ("verified lead"); anything weaker becomes a standalone unverified
 * lead; a hard reject is dropped.
 *
 *   - drop   → hard DMARC reject; the caller creates nothing.
 *   - attach → DMARC pass AND the From matches an existing user → reuse that
 *              identity's principal (a verified lead adopting a known contact).
 *   - create → a new anonymous principal carrying the (verified-or-not) contact
 *              email; `unverified` drives the agent-facing "unverified sender"
 *              badge and blocks silent attachment to a known identity.
 *
 * Resolution only touches identity; the caller owns creating the conversation.
 */
import { db, sql, eq, user, principal, conversations, conversationMessages } from '@/lib/server/db'
import type { TiptapContent, ConversationAttachment } from '@/lib/server/db'
import type { PrincipalId, ChannelAccountId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { realEmail } from '@/lib/shared/anonymous-email'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { validateAttachments } from '@/lib/server/messages/message-core'
import {
  createPrincipal,
  ensurePrincipalForUser,
} from '@/lib/server/domains/principals/principal.factory'
import { evaluateInboundAuth, type InboundAuthResult } from './email-auth'
import type { ParsedInboundEmail } from './conversation.email-inbound'
import type { ConversationAuthorInput } from './conversation.types'
import { emitConversationCreated, emitMessageCreated } from './conversation.webhooks'

export type ColdInboundResolution =
  | { action: 'drop'; verdict: InboundAuthResult }
  | {
      action: 'attach' | 'create'
      principalId: PrincipalId
      /** True for a weak-auth lead — drives the unverified-sender badge. */
      unverified: boolean
      verdict: InboundAuthResult
    }

/**
 * Resolve the sender of a cold inbound email to a principal (or a drop), gated by
 * the Authentication-Results header. `fromEmail` is the raw From address.
 */
export async function resolveColdInboundSender(
  fromEmail: string | null,
  authResultsHeader: string | null
): Promise<ColdInboundResolution> {
  const verdict = evaluateInboundAuth(authResultsHeader)
  if (verdict.verdict === 'reject') return { action: 'drop', verdict }

  const email = realEmail(fromEmail)?.toLowerCase() ?? null

  // Attach only under a DMARC pass to an existing user (the trust gate is the
  // only path that adopts a known identity by address).
  if (email && verdict.verdict === 'pass') {
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(sql`lower(${user.email})`, email))
      .limit(1)
    if (existing) {
      const { principal } = await ensurePrincipalForUser({ userId: existing.id, role: 'user' })
      return { action: 'attach', principalId: principal.id, unverified: false, verdict }
    }
  }

  // Otherwise a new standalone lead: an anonymous principal carrying the contact
  // email. A DMARC pass with no existing account is still a verified lead; a weak
  // verdict is unverified and gets the badge.
  const lead = await createPrincipal({ role: 'user', type: 'anonymous', contactEmail: email })
  return {
    action: 'create',
    principalId: lead.id,
    unverified: verdict.verdict !== 'pass',
    verdict,
  }
}

/**
 * Create a fresh email conversation from a cold inbound message: the conversation
 * (channel='email', source='email', pinned to the inbound route, waiting on a
 * reply, unverified-sender badge when the auth was weak) + its first visitor
 * message, then fire conversation.created and message.created (first message) —
 * the second being what the team bell, message-triggered workflows and the
 * next-response SLA clock all ride, so an emailed-in thread raises the same
 * signals a widget-started one does. Direct inserts (the visitor-message create
 * path hardcodes channel='messenger'); the emit bridge is error-isolated.
 */
export async function createEmailConversation(input: {
  parsed: ParsedInboundEmail
  channelAccountId: ChannelAccountId
  principalId: PrincipalId
  unverified: boolean
  content: string
  /** Rich body converted from the inbound HTML, or null for a plaintext mail. */
  contentJson?: TiptapContent | null
  /** Discrete files rehosted from the inbound MIME parts, or none. */
  attachments?: ConversationAttachment[]
}): Promise<ConversationId> {
  const { parsed, channelAccountId, principalId, unverified, content, contentJson } = input
  // Direct insert bypasses sendVisitorMessage, so mirror its guards here: an
  // untrusted sender's inline images may only reference our own storage (a
  // cold-inbound cid: / external src is cleared until the attachment task
  // rehosts it), and attachments are re-validated (own-storage url, count, size)
  // — same as every other visitor-ingress channel.
  const safeContentJson = contentJson
    ? sanitizeTiptapContent(contentJson, { restrictImagesToTrustedOrigins: true })
    : null
  const attachments = validateAttachments(input.attachments)
  const now = new Date()
  const { conversation, message } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversations)
      .values({
        visitorPrincipalId: principalId,
        channel: 'email',
        source: 'email',
        channelAccountId,
        status: 'open',
        subject: parsed.subject?.slice(0, 200) ?? null,
        lastMessagePreview: (content || (attachments[0] ? attachments[0].name : '')).slice(0, 200),
        lastMessageAt: now,
        // The customer is waiting on the first reply from the moment it lands.
        waitingSince: now,
        visitorEmail: realEmail(parsed.from)?.toLowerCase() ?? null,
        customAttributes: unverified ? { unverifiedSender: true } : {},
      })
      .returning()

    // Returned so message.created below can carry the real row — the event
    // bridge reads its id, senderType, principalId, content and createdAt.
    const [inserted] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: created.id,
        principalId,
        senderType: 'visitor',
        content,
        contentJson: safeContentJson,
        attachments: attachments.length > 0 ? attachments : null,
        metadata: { source: 'email', emailMessageId: parsed.messageId ?? undefined },
      })
      .returning()
    return { conversation: created, message: inserted }
  })

  // A customer-initiated event: the visitor is the actor so it counts as human.
  const actor: Actor = {
    principalId,
    role: 'user',
    principalType: 'anonymous',
    segmentIds: new Set(),
  }
  const author: ConversationAuthorInput = { principalId, displayName: null }
  await emitConversationCreated(actor, author, conversation)
  // `true` is not decoration: the notification hook's anti-spam gate skips the
  // team bell entirely when the message is NOT the first one and any agent is
  // online, so passing false here would leave this defect half-fixed.
  await emitMessageCreated(actor, author, message, conversation, true)

  return conversation.id
}

/** Compensate a failed cold-inbound create before any durable activity exists. */
export async function cleanupColdInboundLead(principalId: PrincipalId): Promise<void> {
  await db.delete(principal).where(eq(principal.id, principalId))
}
