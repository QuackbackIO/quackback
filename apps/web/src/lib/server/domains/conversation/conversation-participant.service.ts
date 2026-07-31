/**
 * Conversation participants (§4.8 group threads): the customers beyond the
 * primary visitor that an agent has added to a conversation. Adding resolves
 * the address to a principal — an existing user account wins, then a lead
 * minted from an earlier email, then a fresh standalone lead (the same
 * identity precedence as cold-inbound, minus its DMARC trust gate: the agent's
 * explicit add IS the trust decision) — and records the (conversation,
 * principal) row idempotently. Removal deletes that row; both changes post an
 * internal (team-only) thread notice so membership churn is auditable in one
 * place. The reply fan-out (conversation.notify) reads
 * `listParticipantReplyRecipients` live on every reply, so a removed
 * participant stops receiving mail with the next reply.
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
 * every reply as the primary recipient). A genuinely new participant gets an
 * internal (team-only) thread notice — the same record `removeConversationParticipant`
 * posts on removal, so membership churn is always auditable in the thread.
 * Returns the resolved principal id.
 */
export async function addConversationParticipantByEmail(
  conversationId: ConversationId,
  email: string,
  actor: Actor,
  opts?: { actorDisplayName?: string | null }
): Promise<{ principalId: PrincipalId }> {
  const [conversation] = await db
    .select({ visitorPrincipalId: conversations.visitorPrincipalId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conversation) throw new NotFoundError('NOT_FOUND', 'Conversation not found')

  const normalizedEmail = email.trim().toLowerCase()
  const principalId = await resolveCustomerPrincipalByEmail(email)
  if (principalId === conversation.visitorPrincipalId) return { principalId }

  const inserted = await db
    .insert(conversationParticipants)
    .values({ conversationId, principalId, addedByPrincipalId: actor.principalId })
    .onConflictDoNothing()
    .returning({ principalId: conversationParticipants.principalId })
  if (inserted.length > 0) {
    const { emitSystemMessage } = await import('./conversation.service')
    const byName = opts?.actorDisplayName ? ` by ${opts.actorDisplayName}` : ''
    await emitSystemMessage(
      conversationId,
      `${normalizedEmail} was added to the conversation${byName} — they will receive future replies by email`,
      undefined,
      { internal: true }
    )
  }
  return { principalId }
}

/**
 * Remove an added customer from a conversation. Clean no-op when the principal
 * was never a participant (`removed: false`, no notice) — a double-click or a
 * stale dialog must not error. The reply fan-out reads the join table live on
 * every reply, so the deletion alone stops delivery; the internal thread
 * notice mirrors the one the add path posts, keeping membership churn
 * auditable in one place.
 */
export async function removeConversationParticipant(
  conversationId: ConversationId,
  participantPrincipalId: PrincipalId,
  actor: Actor,
  opts?: { actorDisplayName?: string | null }
): Promise<{ removed: boolean }> {
  // Read the participant's label first so the notice can name who was removed.
  const [participant] = await db
    .select({
      displayName: principal.displayName,
      userEmail: user.email,
      contactEmail: principal.contactEmail,
    })
    .from(conversationParticipants)
    .innerJoin(principal, eq(principal.id, conversationParticipants.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.principalId, participantPrincipalId)
      )
    )
    .limit(1)

  const deleted = await db
    .delete(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.principalId, participantPrincipalId)
      )
    )
    .returning({ principalId: conversationParticipants.principalId })
  if (deleted.length === 0) return { removed: false }

  const label =
    realEmail(participant?.userEmail) ??
    realEmail(participant?.contactEmail) ??
    participant?.displayName ??
    'A customer'
  const { emitSystemMessage } = await import('./conversation.service')
  const byName = opts?.actorDisplayName ? ` by ${opts.actorDisplayName}` : ''
  await emitSystemMessage(
    conversationId,
    `${label} was removed from the conversation${byName} — they no longer receive replies`,
    undefined,
    { internal: true }
  )
  return { removed: true }
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
