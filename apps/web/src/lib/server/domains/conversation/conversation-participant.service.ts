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
  or,
  ne,
  lt,
  isNull,
  sql,
  conversations,
  conversationParticipants,
  principal,
  user,
} from '@/lib/server/db'
import {
  participantThreadAccessSql,
  participantWatchesPairTicketSql,
} from '@/lib/server/messages/pair-link'
import { resolvePrincipalIdByEmail } from './conversation.email-store'
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
 *
 * `threadAccess` (ticket sharing) also lets the participant open and reply on
 * the thread from the portal and the widget; it is only ever set for a
 * conversation paired with a customer ticket (the access check requires the
 * pair regardless). An existing email-only participant is upgraded in place.
 */
export async function addConversationParticipantByEmail(
  conversationId: ConversationId,
  email: string,
  actor: Actor,
  opts?: { actorDisplayName?: string | null; threadAccess?: boolean }
): Promise<{ principalId: PrincipalId; added: boolean }> {
  const visitorPrincipalId = await conversationVisitorOr404(conversationId)
  const principalId = await resolveCustomerPrincipalByEmail(email)
  const { added } = await recordParticipant(
    conversationId,
    visitorPrincipalId,
    principalId,
    actor,
    {
      ...opts,
      label: email.trim().toLowerCase(),
    }
  )
  return { principalId, added }
}

/**
 * Add an existing customer principal to a conversation (the requester sharing
 * a ticket with a colleague the workspace already knows). Same rules as
 * `addConversationParticipantByEmail`; `label` names them in the team-only
 * thread notice. `added` is false when nothing changed (the visitor
 * themselves, or someone who already had the same access).
 */
export async function addConversationParticipant(
  conversationId: ConversationId,
  principalId: PrincipalId,
  actor: Actor,
  opts: { actorDisplayName?: string | null; threadAccess?: boolean; label: string }
): Promise<{ added: boolean }> {
  const visitorPrincipalId = await conversationVisitorOr404(conversationId)
  return recordParticipant(conversationId, visitorPrincipalId, principalId, actor, opts)
}

async function conversationVisitorOr404(conversationId: ConversationId): Promise<PrincipalId> {
  const [conversation] = await db
    .select({ visitorPrincipalId: conversations.visitorPrincipalId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conversation) throw new NotFoundError('NOT_FOUND', 'Conversation not found')
  return conversation.visitorPrincipalId
}

/** Write (or upgrade) one participant row and post the team-only notice. */
async function recordParticipant(
  conversationId: ConversationId,
  visitorPrincipalId: PrincipalId,
  principalId: PrincipalId,
  actor: Actor,
  opts: { actorDisplayName?: string | null; threadAccess?: boolean; label: string }
): Promise<{ added: boolean }> {
  if (principalId === visitorPrincipalId) return { added: false }

  const threadAccess = opts.threadAccess === true
  const inserted = await db
    .insert(conversationParticipants)
    .values({ conversationId, principalId, addedByPrincipalId: actor.principalId, threadAccess })
    .onConflictDoNothing()
    .returning({ principalId: conversationParticipants.principalId })
  let added = inserted.length > 0
  if (!added && threadAccess) {
    // An email-only participant from before the conversation became a shared
    // ticket thread: give them the thread now.
    const upgraded = await db
      .update(conversationParticipants)
      .set({ threadAccess: true })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.principalId, principalId),
          eq(conversationParticipants.threadAccess, false)
        )
      )
      .returning({ principalId: conversationParticipants.principalId })
    added = upgraded.length > 0
  }
  if (added) {
    const { emitSystemMessage } = await import('./conversation.service')
    const byName = opts.actorDisplayName ? ` by ${opts.actorDisplayName}` : ''
    await emitSystemMessage(
      conversationId,
      threadAccess
        ? `${opts.label} was added to this ticket${byName} — they can see and reply on the thread, and receive future replies by email`
        : `${opts.label} was added to the conversation${byName} — they will receive future replies by email`,
      undefined,
      { internal: true }
    )
  }
  return { added }
}

/**
 * Whether `principalId` was given this conversation's shared ticket thread
 * (see `participantThreadAccessSql`). Takes an executor so the send path can
 * check inside its own transaction.
 */
export async function hasParticipantThreadAccess(
  conversationId: ConversationId,
  principalId: PrincipalId,
  executor: Pick<typeof db, 'select'> = db
): Promise<boolean> {
  const [row] = await executor
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), participantThreadAccessSql(principalId)))
    .limit(1)
  return Boolean(row)
}

/** A participant's own read watermark on a shared thread (null = never read). */
export async function getParticipantLastReadAt(
  conversationId: ConversationId,
  principalId: PrincipalId
): Promise<Date | null> {
  const [row] = await db
    .select({ lastReadAt: conversationParticipants.lastReadAt })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.principalId, principalId)
      )
    )
    .limit(1)
  return row?.lastReadAt ?? null
}

/** Move a participant's read watermark forward (never back) to `at`. */
export async function markParticipantRead(
  conversationId: ConversationId,
  principalId: PrincipalId,
  at: Date,
  executor: Pick<typeof db, 'update'> = db
): Promise<void> {
  await executor
    .update(conversationParticipants)
    .set({ lastReadAt: at })
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.principalId, principalId),
        or(isNull(conversationParticipants.lastReadAt), lt(conversationParticipants.lastReadAt, at))
      )
    )
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
export interface ConversationParticipant {
  principalId: PrincipalId
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  /** Was given the shared ticket thread (portal and widget access). */
  threadAccess: boolean
  addedByPrincipalId: PrincipalId | null
}

export async function listConversationParticipants(
  conversationId: ConversationId
): Promise<ConversationParticipant[]> {
  const rows = await db
    .select({
      principalId: conversationParticipants.principalId,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
      userName: user.name,
      userEmail: user.email,
      contactEmail: principal.contactEmail,
      threadAccess: conversationParticipants.threadAccess,
      addedByPrincipalId: conversationParticipants.addedByPrincipalId,
    })
    .from(conversationParticipants)
    .innerJoin(principal, eq(principal.id, conversationParticipants.principalId))
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        // The visitor is never a participant of their own thread (a merge can
        // leave such a row behind; the add path never writes one).
        ne(conversationParticipants.principalId, conversations.visitorPrincipalId)
      )
    )
    .orderBy(conversationParticipants.createdAt)
  return rows.map((row) => ({
    principalId: row.principalId,
    displayName: row.userName ?? row.displayName,
    email: realEmail(row.userEmail) ?? realEmail(row.contactEmail),
    avatarUrl: row.avatarUrl,
    threadAccess: row.threadAccess,
    addedByPrincipalId: row.addedByPrincipalId,
  }))
}

/**
 * Deliverable addresses for the reply fan-out: every participant (a shared
 * ticket's participant only while they watch it) whose principal resolves to
 * a real address (account email, else contact email;
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
      threadAccess: conversationParticipants.threadAccess,
      watching: participantWatchesPairTicketSql(),
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
    // Someone the ticket was shared with follows it like its requester: once
    // they stop watching (or while muted) the replies stop reaching them.
    if (row.threadAccess && !row.watching) continue
    const email = realEmail(row.userEmail) ?? realEmail(row.contactEmail)
    if (!email) continue
    const key = email.toLowerCase()
    if (key === excludedEmail || seen.has(key)) continue
    seen.add(key)
    recipients.push({ principalId: row.principalId, email })
  }
  return recipients
}

/**
 * The customer a conversation's paired ticket was shared with whose address
 * sent this mail: their account email or contact email, or an address whose
 * recorded channel identity resolves to them. Null for anyone else, including
 * a group-thread participant without the shared thread.
 */
export async function findThreadAccessParticipantBySender(
  conversationId: ConversationId,
  sender: string
): Promise<typeof principal.$inferSelect | null> {
  const rows = await db
    .select({ principal, userEmail: user.email })
    .from(conversationParticipants)
    .innerJoin(principal, eq(principal.id, conversationParticipants.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.threadAccess, true)
      )
    )
  if (rows.length === 0) return null
  const byAddress = rows.find((r) =>
    [r.userEmail, r.principal.contactEmail]
      .map((e) => realEmail(e)?.toLowerCase() ?? null)
      .includes(sender)
  )
  const match =
    byAddress ??
    (await (async () => {
      const mapped = await resolvePrincipalIdByEmail(sender)
      return mapped ? rows.find((r) => r.principal.id === mapped) : undefined
    })())
  if (!match) return null
  return (await hasParticipantThreadAccess(conversationId, match.principal.id as PrincipalId))
    ? match.principal
    : null
}
