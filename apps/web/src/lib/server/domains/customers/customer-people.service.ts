import {
  db,
  eq,
  and,
  or,
  inArray,
  isNull,
  sql,
  asc,
  desc,
  contacts,
  organizations,
  contactUserLinks,
  principal,
  user,
  posts,
  comments,
  votes,
  tickets,
  userSegments,
  segments,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { ContactId, OrganizationId, PrincipalId, SegmentId, UserId } from '@quackback/ids'
import type { UserSegmentSummary } from '../users/user.types'
import { searchContacts } from '../organizations/contact.service'
import { realEmail } from '@/lib/shared/anonymous-email'

export interface CustomerPersonListParams {
  search?: string
  includeArchived?: boolean
  segmentIds?: SegmentId[]
  includeCrm?: boolean
  includeTicketCounts?: boolean
  limit?: number
  offset?: number
}

export type CustomerPersonKind = 'linked' | 'contact' | 'portal_user'

export interface CustomerPersonLinkedUser {
  principalId: PrincipalId
  userId: UserId
  name: string | null
  email: string | null
  image: string | null
  emailVerified: boolean
  joinedAt: Date
}

export interface CustomerPersonListItem {
  id: string
  kind: CustomerPersonKind
  contactId: ContactId | null
  principalIds: PrincipalId[]
  userIds: UserId[]
  name: string | null
  email: string | null
  avatarUrl: string | null
  organizationId: OrganizationId | null
  organizationName: string | null
  title: string | null
  phone: string | null
  externalId: string | null
  archivedAt: Date | null
  hasPortalUser: boolean
  emailVerified: boolean
  linkedUsers: CustomerPersonLinkedUser[]
  segments: UserSegmentSummary[]
  postCount: number
  commentCount: number
  voteCount: number
  ticketCount: number
}

export interface CustomerPersonListResult {
  items: CustomerPersonListItem[]
  total: number
  hasMore: boolean
}

interface PortalSummary extends CustomerPersonLinkedUser {
  postCount: number
  commentCount: number
  voteCount: number
  segments: UserSegmentSummary[]
}

async function fetchSegmentsForPrincipals(
  principalIds: PrincipalId[]
): Promise<Map<string, UserSegmentSummary[]>> {
  if (principalIds.length === 0) return new Map()

  const rows = await db
    .select({
      principalId: userSegments.principalId,
      segmentId: segments.id,
      segmentName: segments.name,
      segmentColor: segments.color,
      segmentType: segments.type,
    })
    .from(userSegments)
    .innerJoin(segments, eq(userSegments.segmentId, segments.id))
    .where(and(inArray(userSegments.principalId, principalIds), isNull(segments.deletedAt)))
    .orderBy(asc(segments.name))

  const map = new Map<string, UserSegmentSummary[]>()
  for (const row of rows) {
    const list = map.get(row.principalId) ?? []
    list.push({
      id: row.segmentId as SegmentId,
      name: row.segmentName,
      color: row.segmentColor,
      type: row.segmentType as 'manual' | 'dynamic',
    })
    map.set(row.principalId, list)
  }
  return map
}

async function fetchPortalSummariesByUserIds(
  userIds: UserId[]
): Promise<Map<string, PortalSummary>> {
  if (userIds.length === 0) return new Map()

  const postCounts = db
    .select({
      principalId: posts.principalId,
      postCount: sql<number>`count(*)::int`.as('post_count'),
    })
    .from(posts)
    .where(isNull(posts.deletedAt))
    .groupBy(posts.principalId)
    .as('post_counts')

  const commentCounts = db
    .select({
      principalId: comments.principalId,
      commentCount: sql<number>`count(*)::int`.as('comment_count'),
    })
    .from(comments)
    .where(isNull(comments.deletedAt))
    .groupBy(comments.principalId)
    .as('comment_counts')

  const voteCounts = db
    .select({
      principalId: votes.principalId,
      voteCount: sql<number>`count(*)::int`.as('vote_count'),
    })
    .from(votes)
    .groupBy(votes.principalId)
    .as('vote_counts')

  const rows = await db
    .select({
      principalId: principal.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
      joinedAt: principal.createdAt,
      postCount: sql<number>`COALESCE(${postCounts.postCount}, 0)`,
      commentCount: sql<number>`COALESCE(${commentCounts.commentCount}, 0)`,
      voteCount: sql<number>`COALESCE(${voteCounts.voteCount}, 0)`,
    })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .leftJoin(postCounts, eq(postCounts.principalId, principal.id))
    .leftJoin(commentCounts, eq(commentCounts.principalId, principal.id))
    .leftJoin(voteCounts, eq(voteCounts.principalId, principal.id))
    .where(
      and(
        eq(principal.role, 'user'),
        eq(principal.type, 'user'),
        inArray(user.id, userIds as UserId[])
      )
    )

  const segmentMap = await fetchSegmentsForPrincipals(
    rows.map((row) => row.principalId as PrincipalId)
  )
  return new Map(
    rows.map((row) => [
      row.userId,
      {
        principalId: row.principalId as PrincipalId,
        userId: row.userId as UserId,
        name: row.name,
        email: realEmail(row.email),
        image: row.image,
        emailVerified: row.emailVerified,
        joinedAt: row.joinedAt,
        postCount: Number(row.postCount),
        commentCount: Number(row.commentCount),
        voteCount: Number(row.voteCount),
        segments: segmentMap.get(row.principalId) ?? [],
      },
    ])
  )
}

async function fetchPortalMatches(params: CustomerPersonListParams): Promise<PortalSummary[]> {
  const conditions: SQL[] = [eq(principal.role, 'user'), eq(principal.type, 'user')]
  if (params.search?.trim()) {
    const q = `%${params.search.trim()}%`
    conditions.push(or(sql`${user.name} ILIKE ${q}`, sql`${user.email} ILIKE ${q}`)!)
  }
  if (params.segmentIds?.length) {
    conditions.push(
      inArray(
        principal.id,
        db
          .select({ principalId: userSegments.principalId })
          .from(userSegments)
          .where(inArray(userSegments.segmentId, params.segmentIds))
      )
    )
  }

  const rows = await db
    .select({ userId: user.id })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(principal.createdAt))
    .limit(Math.min(params.limit ?? 100, 200))
    .offset(Math.max(params.offset ?? 0, 0))

  const summaries = await fetchPortalSummariesByUserIds(rows.map((row) => row.userId as UserId))
  return rows.map((row) => summaries.get(row.userId)).filter((row): row is PortalSummary => !!row)
}

async function fetchContactsByIds(contactIds: ContactId[]) {
  if (contactIds.length === 0) return []
  return db.select().from(contacts).where(inArray(contacts.id, contactIds))
}

async function fetchOrganizationNames(
  organizationIds: OrganizationId[]
): Promise<Map<string, string>> {
  if (organizationIds.length === 0) return new Map()
  const rows = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.id, organizationIds))
  return new Map(rows.map((row) => [row.id, row.name]))
}

async function fetchTicketCounts(input: {
  contactIds: ContactId[]
  principalIds: PrincipalId[]
}): Promise<{ byContact: Map<string, number>; byPrincipal: Map<string, number> }> {
  const byContact = new Map<string, number>()
  const byPrincipal = new Map<string, number>()

  if (input.contactIds.length > 0) {
    const rows = await db
      .select({
        contactId: tickets.requesterContactId,
        count: sql<number>`count(distinct ${tickets.id})::int`,
      })
      .from(tickets)
      .where(and(inArray(tickets.requesterContactId, input.contactIds), isNull(tickets.deletedAt)))
      .groupBy(tickets.requesterContactId)
    for (const row of rows) {
      if (row.contactId) byContact.set(row.contactId, Number(row.count))
    }
  }

  if (input.principalIds.length > 0) {
    const principalTicketConditions: SQL[] = [
      inArray(tickets.requesterPrincipalId, input.principalIds),
      isNull(tickets.deletedAt),
    ]
    if (input.contactIds.length > 0) {
      principalTicketConditions.push(isNull(tickets.requesterContactId))
    }
    const rows = await db
      .select({
        principalId: tickets.requesterPrincipalId,
        count: sql<number>`count(distinct ${tickets.id})::int`,
      })
      .from(tickets)
      .where(and(...principalTicketConditions))
      .groupBy(tickets.requesterPrincipalId)
    for (const row of rows) {
      if (row.principalId) byPrincipal.set(row.principalId, Number(row.count))
    }
  }

  return { byContact, byPrincipal }
}

function uniqueSegments(users: PortalSummary[]): UserSegmentSummary[] {
  const map = new Map<string, UserSegmentSummary>()
  for (const portalUser of users) {
    for (const segment of portalUser.segments) map.set(segment.id, segment)
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function matchesSegmentFilter(users: PortalSummary[], segmentIds?: SegmentId[]): boolean {
  if (!segmentIds?.length) return true
  const wanted = new Set(segmentIds)
  return users.some((portalUser) =>
    portalUser.segments.some((segment) => wanted.has(segment.id as SegmentId))
  )
}

export async function listCustomerPeople(
  params: CustomerPersonListParams = {}
): Promise<CustomerPersonListResult> {
  const limit = Math.min(params.limit ?? 100, 200)
  const offset = Math.max(params.offset ?? 0, 0)

  if (params.includeCrm === false) {
    const portalMatches = await fetchPortalMatches({ ...params, limit, offset })
    const principalIds = portalMatches.map((portalUser) => portalUser.principalId as PrincipalId)
    const ticketCounts =
      params.includeTicketCounts === false
        ? { byContact: new Map<string, number>(), byPrincipal: new Map<string, number>() }
        : await fetchTicketCounts({ contactIds: [], principalIds })
    const items = portalMatches
      .map((row) => ({
        id: `user:${row.principalId}`,
        kind: 'portal_user' as const,
        contactId: null,
        principalIds: [row.principalId],
        userIds: [row.userId],
        name: row.name,
        email: row.email,
        avatarUrl: row.image,
        organizationId: null,
        organizationName: null,
        title: null,
        phone: null,
        externalId: null,
        archivedAt: null,
        hasPortalUser: true,
        emailVerified: row.emailVerified,
        linkedUsers: [row],
        segments: row.segments,
        postCount: row.postCount,
        commentCount: row.commentCount,
        voteCount: row.voteCount,
        ticketCount: ticketCounts.byPrincipal.get(row.principalId) ?? 0,
      }))
      .sort((a, b) => (a.name ?? a.email ?? a.id).localeCompare(b.name ?? b.email ?? b.id))

    return {
      items,
      total: items.length,
      hasMore: false,
    }
  }

  const [contactMatches, portalMatches] = await Promise.all([
    searchContacts({
      query: params.search,
      includeArchived: params.includeArchived,
      limit,
      offset,
    }),
    fetchPortalMatches({ ...params, limit, offset }),
  ])

  const portalUserIds = portalMatches.map((row) => row.userId)
  const linksForPortalMatches =
    portalUserIds.length > 0
      ? await db
          .select({ contactId: contactUserLinks.contactId, userId: contactUserLinks.userId })
          .from(contactUserLinks)
          .where(inArray(contactUserLinks.userId, portalUserIds))
      : []

  const contactIdSet = new Set<ContactId>(contactMatches.map((contact) => contact.id as ContactId))
  for (const link of linksForPortalMatches) contactIdSet.add(link.contactId as ContactId)

  const contactRowsById = new Map(contactMatches.map((contact) => [contact.id, contact]))
  const missingContactIds = Array.from(contactIdSet).filter((id) => !contactRowsById.has(id))
  for (const contact of await fetchContactsByIds(missingContactIds)) {
    if (!params.includeArchived && contact.archivedAt) continue
    contactRowsById.set(contact.id, contact)
  }

  const contactIds = Array.from(contactRowsById.keys()) as ContactId[]
  const contactLinks =
    contactIds.length > 0
      ? await db
          .select({ contactId: contactUserLinks.contactId, userId: contactUserLinks.userId })
          .from(contactUserLinks)
          .where(inArray(contactUserLinks.contactId, contactIds))
      : []

  const linkedUserIds = Array.from(new Set(contactLinks.map((link) => link.userId as UserId)))
  const linkedSummaries = await fetchPortalSummariesByUserIds(linkedUserIds)
  const portalByUserId = new Map<string, PortalSummary>()
  for (const row of portalMatches) portalByUserId.set(row.userId, row)
  for (const row of linkedSummaries.values()) portalByUserId.set(row.userId, row)

  const linksByContact = new Map<string, PortalSummary[]>()
  const linkedPortalUserIds = new Set<string>()
  for (const link of contactLinks) {
    const portalUser = portalByUserId.get(link.userId)
    if (!portalUser) continue
    linkedPortalUserIds.add(link.userId)
    const list = linksByContact.get(link.contactId) ?? []
    list.push(portalUser)
    linksByContact.set(link.contactId, list)
  }

  const organizationIds = Array.from(
    new Set(
      Array.from(contactRowsById.values())
        .map((contact) => contact.organizationId)
        .filter((id): id is OrganizationId => !!id)
    )
  )
  const organizationNames = await fetchOrganizationNames(organizationIds)

  const principalIds = Array.from(
    new Set([...portalByUserId.values()].map((portalUser) => portalUser.principalId as PrincipalId))
  )
  const ticketCounts =
    params.includeTicketCounts === false
      ? { byContact: new Map<string, number>(), byPrincipal: new Map<string, number>() }
      : await fetchTicketCounts({ contactIds, principalIds })

  const contactRows: CustomerPersonListItem[] = Array.from(contactRowsById.values())
    .map((contact) => {
      const linkedUsers = linksByContact.get(contact.id) ?? []
      const principalIds = linkedUsers.map((row) => row.principalId)
      const firstPortalUser = linkedUsers[0]
      return {
        id: `contact:${contact.id}`,
        kind: linkedUsers.length > 0 ? 'linked' : 'contact',
        contactId: contact.id as ContactId,
        principalIds,
        userIds: linkedUsers.map((row) => row.userId),
        name: contact.name ?? firstPortalUser?.name ?? null,
        email: contact.email ?? firstPortalUser?.email ?? null,
        avatarUrl: contact.avatarUrl ?? firstPortalUser?.image ?? null,
        organizationId: (contact.organizationId as OrganizationId | null) ?? null,
        organizationName: contact.organizationId
          ? (organizationNames.get(contact.organizationId) ?? null)
          : null,
        title: contact.title,
        phone: contact.phone,
        externalId: contact.externalId,
        archivedAt: contact.archivedAt,
        hasPortalUser: linkedUsers.length > 0,
        emailVerified: linkedUsers.some((row) => row.emailVerified),
        linkedUsers,
        segments: uniqueSegments(linkedUsers),
        postCount: linkedUsers.reduce((sum, row) => sum + row.postCount, 0),
        commentCount: linkedUsers.reduce((sum, row) => sum + row.commentCount, 0),
        voteCount: linkedUsers.reduce((sum, row) => sum + row.voteCount, 0),
        ticketCount:
          (ticketCounts.byContact.get(contact.id) ?? 0) +
          principalIds.reduce((sum, id) => sum + (ticketCounts.byPrincipal.get(id) ?? 0), 0),
      }
    })
    .filter((row) => {
      if (!params.segmentIds?.length) return true
      return matchesSegmentFilter(row.linkedUsers, params.segmentIds)
    })

  const portalOnlyRows: CustomerPersonListItem[] = portalMatches
    .filter((row) => !linkedPortalUserIds.has(row.userId))
    .map((row) => ({
      id: `user:${row.principalId}`,
      kind: 'portal_user',
      contactId: null,
      principalIds: [row.principalId],
      userIds: [row.userId],
      name: row.name,
      email: row.email,
      avatarUrl: row.image,
      organizationId: null,
      organizationName: null,
      title: null,
      phone: null,
      externalId: null,
      archivedAt: null,
      hasPortalUser: true,
      emailVerified: row.emailVerified,
      linkedUsers: [row],
      segments: row.segments,
      postCount: row.postCount,
      commentCount: row.commentCount,
      voteCount: row.voteCount,
      ticketCount: ticketCounts.byPrincipal.get(row.principalId) ?? 0,
    }))

  const items = [...contactRows, ...portalOnlyRows].sort((a, b) =>
    (a.name ?? a.email ?? a.id).localeCompare(b.name ?? b.email ?? b.id)
  )

  return {
    items,
    total: items.length,
    hasMore: false,
  }
}
