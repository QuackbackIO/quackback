/**
 * The customer's side of ticket sharing (ticket-sharing.service has the model
 * and the team's side). What a customer sees of a customer ticket: their own,
 * or one shared with them in the narrower shared view. And sharing it on: the
 * requester shares with a colleague, someone the workspace already has in the
 * requester's own company. Company membership is set by the team, not claimed
 * by the customer, so it is the trust boundary; the requester can neither add
 * arbitrary addresses (no mail to strangers) nor learn whether an address
 * exists (one answer for "unknown" and "not your colleague"). The requester
 * removes the people they added; anyone can leave.
 */
import {
  db,
  and,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  conversationParticipants,
  principal,
  ticketConversations,
  tickets,
  user,
  type Ticket,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { realEmail } from '@/lib/shared/anonymous-email'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { notTestPrincipal } from '@/lib/server/test-data'
import { incrementBucket } from '@/lib/server/utils/rate-bucket'
import { isBlocked } from '@/lib/server/domains/principals/blocking'
import {
  addConversationParticipant,
  hasParticipantThreadAccess,
  removeConversationParticipant,
} from '@/lib/server/domains/conversation/conversation-participant.service'
import { buildTicketContext, ticketToDTO, toSharedTicketDTO } from './ticket.dto'
import type { RequesterTicketDTO } from './ticket.types'
import {
  getRequesterTicketForConversation,
  getRequesterTicketSummaries,
  loadAccessibleTicketOr404,
  summarizePairs,
  type ConversationTicketSummary,
  type TicketRelation,
} from './requester.service'
import {
  afterShare,
  afterUnshare,
  assertRoomFor,
  sharedParticipants,
} from './ticket-sharing.service'

/** How many shares one requester can make an hour, across tickets. */
const SHARE_RATE_MAX = 10
const SHARE_RATE_WINDOW_SECONDS = 60 * 60

/** Who is on a shared ticket, as a customer sees it: names, never emails. */
export interface TicketSharingPerson {
  principalId: PrincipalId
  displayName: string | null
  avatarUrl: string | null
  isRequester: boolean
  isMe: boolean
  /** The viewer may take this person off the ticket (the requester, for the
   *  people they added; anyone, for themselves). */
  canRemove: boolean
}

export interface TicketSharing {
  relation: TicketRelation
  people: TicketSharingPerson[]
  /** The viewer may share with colleagues (the requester, with a company). */
  canShare: boolean
}

/** A colleague the requester may share with: a name and avatar, never an email. */
export interface ShareableColleague {
  principalId: PrincipalId
  displayName: string | null
  avatarUrl: string | null
}

function requirePrincipal(actor: Actor): PrincipalId {
  if (!actor.principalId) throw new ForbiddenError('FORBIDDEN', 'You must be signed in')
  return actor.principalId
}

/**
 * The customer ticket paired with `conversationId` as the caller sees it: the
 * requester's view, or the narrower view of a customer it was shared with
 * (`toSharedTicketDTO`). Null when there is no pair or the caller is neither.
 */
export async function getCustomerTicketForConversation(
  conversationId: ConversationId,
  principalId: PrincipalId
): Promise<{ ticket: RequesterTicketDTO; relation: TicketRelation } | null> {
  const own = await getRequesterTicketForConversation(conversationId, principalId)
  if (own) return { ticket: own, relation: 'requester' }
  if (!(await hasParticipantThreadAccess(conversationId, principalId))) return null
  const [row] = await db
    .select({ ticket: tickets })
    .from(ticketConversations)
    .innerJoin(tickets, eq(ticketConversations.ticketId, tickets.id))
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer'),
        isNull(tickets.deletedAt)
      )
    )
    .limit(1)
  if (!row) return null
  const ctx = await buildTicketContext([row.ticket])
  return {
    ticket: toSharedTicketDTO(ticketToDTO(row.ticket, ctx, 'requester')),
    relation: 'participant',
  }
}

/**
 * `getRequesterTicketSummaries` for a customer's whole Messages list: the
 * pairs they requested plus the shared ticket threads they were given.
 */
export async function getCustomerTicketSummaries(
  conversationIds: ConversationId[],
  principalId: PrincipalId
): Promise<Map<ConversationId, ConversationTicketSummary>> {
  if (conversationIds.length === 0) return new Map()
  const [owned, sharedRows] = await Promise.all([
    getRequesterTicketSummaries(conversationIds, principalId),
    db
      .select({
        conversationId: ticketConversations.conversationId,
        ticketId: tickets.id,
        number: tickets.number,
        title: tickets.title,
        statusId: tickets.statusId,
        dueAt: tickets.dueAt,
      })
      .from(ticketConversations)
      .innerJoin(tickets, eq(ticketConversations.ticketId, tickets.id))
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, ticketConversations.conversationId),
          eq(conversationParticipants.principalId, principalId),
          eq(conversationParticipants.threadAccess, true)
        )
      )
      .where(
        and(
          inArray(ticketConversations.conversationId, conversationIds),
          eq(ticketConversations.ticketType, 'customer'),
          isNull(tickets.deletedAt)
        )
      ),
  ])
  const shared = await summarizePairs(sharedRows)
  return new Map([...shared, ...owned])
}

/** The requester's company, or null when they can't share (no company, an
 *  anonymous or blocked principal, or a ticket filed under another company). */
async function requesterShareCompany(
  ticket: Ticket,
  principalId: PrincipalId
): Promise<string | null> {
  const [me] = await db
    .select({
      type: principal.type,
      companyId: principal.companyId,
      blockedAt: principal.blockedAt,
    })
    .from(principal)
    .where(eq(principal.id, principalId))
    .limit(1)
  if (!me || me.type !== 'user' || me.blockedAt || !me.companyId) return null
  if (ticket.companyId && ticket.companyId !== me.companyId) return null
  return me.companyId
}

/** Who is on a ticket the caller can see, and what they may change. */
export async function getTicketSharing(actor: Actor, ticketId: TicketId): Promise<TicketSharing> {
  const me = requirePrincipal(actor)
  const { ticket, relation, conversationId } = await loadAccessibleTicketOr404(ticketId, me)
  const participants = conversationId ? await sharedParticipants(conversationId) : []
  const people: TicketSharingPerson[] = []
  if (ticket.requesterPrincipalId) {
    const [requester] = await db
      .select({ displayName: principal.displayName, avatarUrl: principal.avatarUrl })
      .from(principal)
      .where(eq(principal.id, ticket.requesterPrincipalId))
      .limit(1)
    people.push({
      principalId: ticket.requesterPrincipalId,
      displayName: requester?.displayName ?? null,
      avatarUrl: requester?.avatarUrl ?? null,
      isRequester: true,
      isMe: ticket.requesterPrincipalId === me,
      canRemove: false,
    })
  }
  for (const p of participants) {
    const isMe = p.principalId === me
    people.push({
      principalId: p.principalId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      isRequester: false,
      isMe,
      canRemove: isMe || (relation === 'requester' && p.addedByPrincipalId === me),
    })
  }
  const canShare =
    relation === 'requester' &&
    conversationId !== null &&
    (await requesterShareCompany(ticket, me)) !== null
  return { relation, people, canShare }
}

/**
 * The requester's colleagues they may share a ticket with: people in their
 * company, not on the team, not blocked, not test customers, with a real
 * address to reach them, and not already on the ticket. Names only. Empty when
 * the requester can't share.
 */
export async function listShareableColleagues(
  actor: Actor,
  ticketId: TicketId,
  query?: string
): Promise<ShareableColleague[]> {
  const me = requirePrincipal(actor)
  const { ticket, relation, conversationId } = await loadAccessibleTicketOr404(ticketId, me)
  if (relation !== 'requester' || !conversationId) return []
  const companyId = await requesterShareCompany(ticket, me)
  if (!companyId) return []
  const onTicket = new Set<string>([
    me,
    ...(await sharedParticipants(conversationId)).map((p) => p.principalId),
  ])
  const term = query?.trim()
  const rows = await db
    .select({
      principalId: principal.id,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
      userEmail: user.email,
      contactEmail: principal.contactEmail,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(
      and(
        eq(principal.companyId, companyId as never),
        eq(principal.role, 'user'),
        ne(principal.type, 'service'),
        isNull(principal.blockedAt),
        notTestPrincipal(principal.id),
        term ? ilike(principal.displayName, `%${term.replace(/[%_\\]/g, '\\$&')}%`) : undefined
      )
    )
    .orderBy(principal.displayName)
    .limit(100)
  return rows
    .filter((r) => !onTicket.has(r.principalId))
    .filter((r) => Boolean(realEmail(r.userEmail) ?? realEmail(r.contactEmail)))
    .map((r) => ({
      principalId: r.principalId,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
    }))
}

/**
 * The requester shares their ticket with a colleague, picked from the list
 * (`principalId`) or typed (`email`, matched only against that same list).
 * Anything outside it is the same COLLEAGUE_NOT_FOUND, so the answer never
 * says whether an address exists.
 */
export async function shareTicketWithColleague(
  actor: Actor,
  ticketId: TicketId,
  target: { principalId: PrincipalId } | { email: string },
  opts?: { actorDisplayName?: string | null }
): Promise<{ principalId: PrincipalId; added: boolean }> {
  const me = requirePrincipal(actor)
  const { ticket, relation, conversationId } = await loadAccessibleTicketOr404(ticketId, me)
  if (relation !== 'requester' || !conversationId) {
    throw new ForbiddenError('FORBIDDEN', 'Only the person who opened this ticket can share it')
  }
  if (await isBlocked(me))
    throw new ForbiddenError('BLOCKED', 'You are not able to share this ticket')
  const companyId = await requesterShareCompany(ticket, me)
  if (!companyId) {
    throw new ForbiddenError('FORBIDDEN', 'You can share a ticket only with people in your company')
  }

  const notFound = () =>
    new NotFoundError('COLLEAGUE_NOT_FOUND', 'No one in your company matches that person')
  let colleagueId: PrincipalId
  if ('principalId' in target) {
    colleagueId = target.principalId
  } else {
    const email = target.email.trim().toLowerCase()
    if (!email) throw notFound()
    const [match] = await db
      .select({ id: principal.id })
      .from(principal)
      .leftJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          eq(principal.companyId, companyId as never),
          or(eq(user.email, email), eq(principal.contactEmail, email))
        )
      )
      .limit(1)
    if (!match) throw notFound()
    colleagueId = match.id
  }
  const eligible = await listShareableColleagues(actor, ticketId)
  const colleague = eligible.find((c) => c.principalId === colleagueId)
  if (!colleague) {
    // Already on the ticket is a quiet success, like any repeat add.
    const already = (await sharedParticipants(conversationId)).some(
      (p) => p.principalId === colleagueId
    )
    if (already) return { principalId: colleagueId, added: false }
    throw notFound()
  }

  const { count } = await incrementBucket({
    key: `ticket:share:${me}`,
    windowSeconds: SHARE_RATE_WINDOW_SECONDS,
  })
  if (count !== null && count > SHARE_RATE_MAX) {
    throw new ForbiddenError('RATE_LIMITED', 'You have shared tickets too often. Try again later.')
  }
  await assertRoomFor(conversationId)

  const { added } = await addConversationParticipant(conversationId, colleagueId, actor, {
    actorDisplayName: opts?.actorDisplayName,
    threadAccess: true,
    label: colleague.displayName ?? 'A colleague',
  })
  if (added) await afterShare(ticket, colleagueId, actor, opts?.actorDisplayName)
  return { principalId: colleagueId, added }
}

/**
 * Take someone off a shared ticket from the customer side: the requester for
 * the people they added, anyone for themselves (leaving). Someone the team
 * added stays until the team removes them.
 */
export async function removeTicketShare(
  actor: Actor,
  ticketId: TicketId,
  principalId: PrincipalId,
  opts?: { actorDisplayName?: string | null }
): Promise<{ removed: boolean }> {
  const me = requirePrincipal(actor)
  const { ticket, relation, conversationId } = await loadAccessibleTicketOr404(ticketId, me)
  if (!conversationId) return { removed: false }
  const participant = (await sharedParticipants(conversationId)).find(
    (p) => p.principalId === principalId
  )
  if (!participant) return { removed: false }
  const leaving = principalId === me
  const ownAdd = relation === 'requester' && participant.addedByPrincipalId === me
  if (!leaving && !ownAdd) {
    throw new ForbiddenError('FORBIDDEN', 'You can remove only the people you added')
  }
  const { removed } = await removeConversationParticipant(conversationId, principalId, actor, opts)
  if (removed) await afterUnshare(ticket, principalId, actor)
  return { removed }
}
