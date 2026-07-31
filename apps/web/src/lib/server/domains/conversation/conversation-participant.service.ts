/**
 * Conversation participants (§4.8 group threads): the customers beyond the
 * primary visitor that an agent has added to a conversation. Adding resolves
 * the address to a principal — an existing user account wins, then a lead
 * minted from an earlier email, then a fresh standalone lead (the same
 * identity precedence as cold-inbound, minus its DMARC trust gate: the agent's
 * explicit add IS the trust decision) — and records the (conversation,
 * principal) row idempotently. The reply fan-out (conversation.notify) reads
 * `listParticipantReplyRecipients` to email every participant each subsequent
 * agent reply.
 */
import {
  db,
  eq,
  and,
  isNull,
  sql,
  conversations,
  conversationParticipants,
  principal,
  user,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { realEmail } from '@/lib/shared/anonymous-email'
import { NotFoundError } from '@/lib/shared/errors'
import {
  ensurePrincipalForUser,
  createPrincipal,
} from '@/lib/server/domains/principals/principal.factory'

/**
 * Resolve an email address to the customer principal it belongs to: an
 * existing user account by address, else a lead we minted from an earlier
 * email (`type='anonymous'` + `userId IS NULL` — the exact fingerprint of a
 * lead we created, so a widget visitor's principal is never adopted by
 * address), else a freshly minted standalone lead. The address is lowercased
 * first so display case never forks an identity.
 */
async function resolveCustomerPrincipalByEmail(rawEmail: string): Promise<PrincipalId> {
  const email = rawEmail.trim().toLowerCase()
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email))
    .limit(1)
  if (account) {
    const { principal: p } = await ensurePrincipalForUser({ userId: account.id, role: 'user' })
    return p.id
  }
  const [lead] = await db
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
  if (lead) return lead.id
  const created = await createPrincipal({ role: 'user', type: 'anonymous', contactEmail: email })
  return created.id
}

/**
 * Add a customer to a conversation by email address. Idempotent: the join
 * row's (conversation, principal) uniqueness makes a repeat add a no-op, and
 * adding the conversation's own visitor records nothing (they already receive
 * every reply as the primary recipient). Returns the resolved principal id.
 */
export async function addConversationParticipantByEmail(
  conversationId: ConversationId,
  email: string,
  actor: Actor
): Promise<{ principalId: PrincipalId }> {
  const [conversation] = await db
    .select({ visitorPrincipalId: conversations.visitorPrincipalId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conversation) throw new NotFoundError('NOT_FOUND', 'Conversation not found')

  const principalId = await resolveCustomerPrincipalByEmail(email)
  if (principalId === conversation.visitorPrincipalId) return { principalId }

  await db
    .insert(conversationParticipants)
    .values({ conversationId, principalId, addedByPrincipalId: actor.principalId })
    .onConflictDoNothing()
  return { principalId }
}

/**
 * The customers an agent has added to a conversation, oldest first, for the
 * agent-side display. `email` is realEmail-sanitized so a synthetic anonymous
 * address never renders.
 */
export async function listConversationParticipants(
  conversationId: ConversationId
): Promise<Array<{ principalId: PrincipalId; displayName: string | null; email: string | null }>> {
  const rows = await db
    .select({
      principalId: conversationParticipants.principalId,
      displayName: principal.displayName,
      userName: user.name,
      userEmail: user.email,
      contactEmail: principal.contactEmail,
    })
    .from(conversationParticipants)
    .innerJoin(principal, eq(principal.id, conversationParticipants.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(conversationParticipants.conversationId, conversationId))
    .orderBy(conversationParticipants.createdAt)
  return rows.map((row) => ({
    principalId: row.principalId,
    displayName: row.userName ?? row.displayName,
    email: realEmail(row.userEmail) ?? realEmail(row.contactEmail),
  }))
}

/**
 * Deliverable addresses for the reply fan-out: every participant whose
 * principal resolves to a real address (account email, else contact email;
 * synthetic anonymous placeholders never qualify), excluding the primary
 * visitor (already the main recipient) and any address the reply is already
 * being sent to (a participant who IS the primary recipient under another
 * principal must not get the mail twice).
 */
export async function listParticipantReplyRecipients(
  conversationId: ConversationId,
  excludePrincipalId: PrincipalId,
  excludeEmail: string | null
): Promise<Array<{ principalId: PrincipalId; email: string }>> {
  const rows = await db
    .select({
      principalId: conversationParticipants.principalId,
      type: principal.type,
      userEmail: user.email,
      contactEmail: principal.contactEmail,
    })
    .from(conversationParticipants)
    .innerJoin(principal, eq(principal.id, conversationParticipants.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(conversationParticipants.conversationId, conversationId))
  const excludedEmail = excludeEmail?.toLowerCase() ?? null
  const seen = new Set<string>()
  const recipients: Array<{ principalId: PrincipalId; email: string }> = []
  for (const row of rows) {
    if (row.principalId === excludePrincipalId) continue
    const email = realEmail(row.userEmail) ?? realEmail(row.contactEmail)
    if (!email) continue
    const key = email.toLowerCase()
    if (key === excludedEmail || seen.has(key)) continue
    seen.add(key)
    recipients.push({ principalId: row.principalId, email })
  }
  return recipients
}
