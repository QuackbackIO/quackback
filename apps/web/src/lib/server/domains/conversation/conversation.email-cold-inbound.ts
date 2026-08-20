/**
 * Cold-inbound sender resolution (support platform §4.8 Layer 2). When an email
 * arrives that isn't a reply to an existing conversation, this decides WHO it is
 * from, gated by the DMARC trust verdict and the decided identity model
 * (IDENTITY-MODEL-ANALYSIS.md): inbound email attaches by address only under a
 * DMARC pass ("verified lead"); anything weaker becomes a standalone unverified
 * lead.
 *
 *   - attach → an existing principal already owns this address: either a DMARC
 *              pass matching a known user account (a verified lead adopting a
 *              known contact), or a lead we minted from an earlier mail. Reusing
 *              the lead is what lets a block on a cold sender actually hold.
 *   - create → a new anonymous principal carrying the (verified-or-not) contact
 *              email; `unverified` drives the agent-facing "unverified sender"
 *              badge and blocks silent attachment to a known identity.
 *
 * A hard DMARC reject resolves like any other weak verdict rather than being
 * refused here. What a reject decides is the DISPOSITION of the message (the
 * caller quarantines it), and disposition is not this function's job — the
 * message still has to be attributed to somebody in order to be retained and
 * reviewed at all. Identity is not weakened by that, and the reason is
 * structural rather than a promise: `pass` is the only branch below that can
 * adopt an existing account, `verdict.verdict === 'pass'` guards it, and a
 * reject verdict can never satisfy that test. Everything a reject can reach
 * mints or reuses an anonymous lead and sets `unverified`.
 *
 * Resolution only touches identity; the caller owns creating the conversation.
 */
import {
  db,
  sql,
  eq,
  and,
  isNull,
  user,
  principal,
  conversations,
  conversationMessages,
} from '@/lib/server/db'
import type {
  TiptapContent,
  ConversationAttachment,
  ConversationSpamFiledBy,
} from '@/lib/server/db'
import type { PrincipalId, ChannelAccountId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { validateAttachments } from '@/lib/server/messages/message-core'
import {
  createPrincipal,
  ensurePrincipalForUser,
} from '@/lib/server/domains/principals/principal.factory'
import { evaluateInboundAuth, type InboundAuthResult } from './email-auth'
import {
  inboundDedupeKey,
  normalizeSenderAddress,
  type ParsedInboundEmail,
} from './conversation.email-inbound'
import type { ConversationAuthorInput } from './conversation.types'
import { emitConversationCreated, emitMessageCreated } from './conversation.webhooks'

export interface ColdInboundResolution {
  action: 'attach' | 'create'
  principalId: PrincipalId
  /** True for a weak-auth lead — drives the unverified-sender badge. */
  unverified: boolean
  verdict: InboundAuthResult
}

/**
 * Resolve the sender of a cold inbound email to a principal, gated by the
 * Authentication-Results header. `fromEmail` is the raw From address.
 */
export async function resolveColdInboundSender(
  fromEmail: string | null,
  authResultsHeader: string | null
): Promise<ColdInboundResolution> {
  const verdict = evaluateInboundAuth(authResultsHeader)

  // The bare address, not the raw header: `"Jane" <jane@acme.com>` must resolve
  // to the same person as `jane@acme.com`, or every distinct display name mints
  // its own lead and the reuse below never matches.
  const email = normalizeSenderAddress(fromEmail)

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

  // A lead we minted for this address on an earlier mail: reuse it instead of
  // minting a second one. This is what makes blocking a cold sender STICK — a
  // principal created fresh on every message can never be blocked, because the
  // block lands on a row the next message will not look at.
  //
  // `userId IS NULL` is a security clause, not an optimisation: anonymous WIDGET
  // visitors also carry a contactEmail (pre-chat capture) but DO have an auth
  // user row, so matching on type+address alone would let a weak-DMARC stranger
  // attach to a live visitor's principal and impersonate them to an agent —
  // exactly what the trust gate above exists to prevent. Cold leads are the only
  // anonymous principals created without a user, which makes this an exact
  // fingerprint for "a lead WE minted from an email".
  if (email) {
    const [existingLead] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.type, 'anonymous'),
          isNull(principal.userId),
          eq(principal.contactEmail, email)
        )
      )
      .limit(1)
    // 'attach', never 'create': the caller's compensating cleanup only fires on
    // 'create', and running it against a pre-existing lead would try to delete a
    // principal that already owns conversations.
    if (existingLead) {
      return {
        action: 'attach',
        principalId: existingLead.id,
        unverified: verdict.verdict !== 'pass',
        verdict,
      }
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
 *
 * `quarantine` inverts both halves of that for a message we REFUSED. It files
 * the thread to Spam in the same INSERT, and it fires neither emit.
 *
 * Filing in the insert rather than with a follow-up update is what makes the
 * refusal hold: there is no instant at which a refused message sits in the open
 * queue, and no second write whose failure would leave it there. Going through
 * the ordinary spam filter instead would reintroduce exactly that, and worse —
 * that path is bypassed for a workspace-trusted sender, so a stranger spoofing
 * a trusted address would land in the normal inbox, which is the one outcome a
 * hard reject exists to prevent.
 *
 * The emits are skipped for the same reason. A refused message must not ring
 * the team bell, fire outbound webhooks, start an SLA clock, or trigger a
 * message workflow — an auto-reply workflow firing on a forged From is
 * backscatter sent in our name, and a bell any stranger can ring is a
 * notification channel we have handed to them.
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
  /** Refused mail: file to Spam in the insert and raise no signals. The cause
   *  is the enumerated one the Spam view badges the row with. */
  quarantine?: { cause: ConversationSpamFiledBy; note: string } | null
}): Promise<ConversationId> {
  const { parsed, channelAccountId, principalId, unverified, content, contentJson } = input
  const quarantine = input.quarantine ?? null
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
        status: quarantine ? 'closed' : 'open',
        subject: parsed.subject?.slice(0, 200) ?? null,
        lastMessagePreview: (content || (attachments[0] ? attachments[0].name : '')).slice(0, 200),
        lastMessageAt: now,
        // The customer is waiting on the first reply from the moment it lands.
        // Nobody is waiting on refused mail — an agent has to release it first.
        waitingSince: quarantine ? null : now,
        // The Spam-view shape, written here rather than by a follow-up update:
        // the same (status, resolvedAt, endReason, spamReason) tuple
        // autoFileConversationAsSpam sets, so the Spam view, restore and
        // delete-forever all see an ordinary spam-filed thread.
        ...(quarantine
          ? {
              resolvedAt: now,
              endReason: 'spam' as const,
              endNote: quarantine.note,
              spamReason: quarantine.cause,
            }
          : {}),
        visitorEmail: normalizeSenderAddress(parsed.from),
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
        // The same derivation the cold-inbound path deduplicated on a moment
        // ago, so the row a redelivery has to match is filed under the key that
        // redelivery will look up.
        metadata: { source: 'email', emailMessageId: inboundDedupeKey(parsed) ?? undefined },
      })
      .returning()
    return { conversation: created, message: inserted }
  })

  // Refused mail raises nothing. It is retained and reviewable, which is the
  // whole point, but it has not been accepted into the conversation flow.
  if (quarantine) return conversation.id

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

  // Routing is channel-agnostic: a cold-inbound email conversation auto-assigns
  // the same way a widget conversation does when routing is enabled.
  const { routeUnassignedConversation } = await import('./conversation.service')
  await routeUnassignedConversation(conversation)

  return conversation.id
}

/** Compensate a failed cold-inbound create before any durable activity exists. */
export async function cleanupColdInboundLead(principalId: PrincipalId): Promise<void> {
  await db.delete(principal).where(eq(principal.id, principalId))
}
