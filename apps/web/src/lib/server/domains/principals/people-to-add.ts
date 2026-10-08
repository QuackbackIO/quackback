/**
 * Who the members page "Add people" picker offers. Only people who have
 * signed in are offered, never the caller, and never a placeholder address.
 */
import {
  account,
  and,
  db,
  desc,
  eq,
  identityProvider,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  principal,
  roles,
  session,
  sql,
  user,
} from '@/lib/server/db'
import type { InviteId, PrincipalId, RoleId, UserId } from '@quackback/ids'
import { z } from 'zod'
import { ANON_EMAIL_DOMAIN, realEmail } from '@/lib/shared/anonymous-email'
import { getAuthProviderByProviderId } from '@/lib/server/auth/auth-providers'
import { resolveUserAvatarUrl } from './principal-display'
import { classifyTeamCandidate, hasSignedInSql, loadTeamCandidates } from './team-promotion'
import { classifyInviteEmail } from './team-invitation'

const RECENT_LIMIT = 5
const SEARCH_LIMIT = 8

export type PersonToAddStatus = 'portal_user' | 'member' | 'admin'

export interface PersonToAdd {
  principalId: PrincipalId
  name: string
  avatarUrl: string | null
  /** Real email, else how the person signs in; never a placeholder address. */
  detail: string
  status: PersonToAddStatus
}

export interface EmailToAdd {
  address: string
  status: 'new' | 'pending_invite' | 'member' | 'portal_user'
  invitationId?: InviteId
  invitedAt?: string
  /** The pending invite's role: Admin, Member, or the custom role's name. */
  roleName?: string
  principalId?: PrincipalId
}

export interface PeopleToAddResult {
  canSearchPeople: boolean
  people: PersonToAdd[]
  email?: EmailToAdd
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

const PLACEHOLDER_EMAIL_PATTERN = `%@${ANON_EMAIL_DOMAIN}`

/**
 * People the caller can add, for the add-people picker.
 *
 * Empty query: the most recently active portal users. Otherwise up to eight
 * matches by name, real email or sign-in provider account id, across portal
 * users and current teammates (returned with their team status so the picker
 * can mark them). Only people who have signed in are offered; the caller is
 * never offered. Without people.view (`canSearchPeople` false) the list stays
 * empty and an email query reveals only team-side facts (teammate, pending
 * invite), never whether a portal user holds the address.
 */
export async function findPeopleToAdd(opts: {
  query: string
  callerPrincipalId: PrincipalId
  canSearchPeople: boolean
}): Promise<PeopleToAddResult> {
  const query = opts.query.trim()
  const people = opts.canSearchPeople
    ? query
      ? await searchPeopleRows(query, opts.callerPrincipalId)
      : await recentPortalUserRows(opts.callerPrincipalId)
    : []

  const result: PeopleToAddResult = {
    canSearchPeople: opts.canSearchPeople,
    people: await toPeopleToAdd(people, query),
  }

  const email = await lookupEmailToAdd(query, opts.canSearchPeople)
  if (email) result.email = email
  return result
}

interface PersonRow {
  principalId: PrincipalId
  userId: string
  role: string
  name: string
  email: string | null
  image: string | null
  imageKey: string | null
}

const personColumns = {
  principalId: principal.id,
  userId: user.id,
  role: principal.role,
  name: user.name,
  email: user.email,
  image: user.image,
  imageKey: user.imageKey,
}

/** Sessions read per page, and pages at most, while collecting recent people. */
const RECENT_SESSION_PAGE = 50
const RECENT_MAX_PAGES = 6

/**
 * The most recently active portal users, newest first. Walks session rows
 * newest-first on session_updatedAt_idx a page at a time (keyset on
 * updated_at, id), joining each to its portal-user principal, and stops once
 * five distinct people are found. A live non-widget session is itself proof
 * of sign-in, so no further eligibility check is needed.
 */
async function recentPortalUserRows(callerPrincipalId: PrincipalId): Promise<PersonRow[]> {
  const found = new Map<string, PersonRow>()
  let cursor: { updatedAt: Date; id: string } | null = null
  for (let page = 0; page < RECENT_MAX_PAGES && found.size < RECENT_LIMIT; page++) {
    const rows: Array<PersonRow & { sessionId: string; sessionAt: Date }> = await db
      .select({ ...personColumns, sessionId: session.id, sessionAt: session.updatedAt })
      .from(session)
      .innerJoin(principal, eq(principal.userId, session.userId))
      .innerJoin(user, eq(user.id, session.userId))
      .where(
        and(
          ne(session.scope, 'widget'),
          cursor
            ? sql`(${session.updatedAt}, ${session.id}) < (${cursor.updatedAt.toISOString()}::timestamptz, ${cursor.id})`
            : undefined,
          eq(principal.type, 'user'),
          eq(principal.role, 'user'),
          ne(principal.id, callerPrincipalId)
        )
      )
      .orderBy(desc(session.updatedAt), desc(session.id))
      .limit(RECENT_SESSION_PAGE)
    for (const row of rows) {
      if (found.size >= RECENT_LIMIT) break
      if (!found.has(row.principalId)) {
        const { sessionId: _s, sessionAt: _a, ...person } = row
        found.set(row.principalId, person as PersonRow)
      }
    }
    if (rows.length < RECENT_SESSION_PAGE) break
    const last = rows[rows.length - 1]!
    cursor = { updatedAt: new Date(last.sessionAt), id: last.sessionId }
  }
  return [...found.values()]
}

async function searchPeopleRows(
  query: string,
  callerPrincipalId: PrincipalId
): Promise<PersonRow[]> {
  const pattern = `%${escapeLike(query)}%`
  const matches = or(
    ilike(user.name, pattern),
    and(ilike(user.email, pattern), sql`${user.email} NOT ILIKE ${PLACEHOLDER_EMAIL_PATTERN}`),
    sql`EXISTS (
      SELECT 1 FROM ${account}
      WHERE ${account.userId} = ${principal.userId}
        AND ${account.providerId} <> 'credential'
        AND ${account.accountId} ILIKE ${pattern}
    )`
  )
  const rows = await db
    .select(personColumns)
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(
      and(
        eq(principal.type, 'user'),
        isNotNull(principal.userId),
        ne(principal.id, callerPrincipalId),
        or(
          inArray(principal.role, ['admin', 'member']),
          and(eq(principal.role, 'user'), hasSignedInSql())
        ),
        matches
      )
    )
    .orderBy(user.name, principal.id)
    .limit(SEARCH_LIMIT)
  return rows as PersonRow[]
}

/** The provider label for an account: the workspace's own IdP label, else the social provider name. */
async function providerLabels(providerIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (providerIds.length === 0) return labels
  const idps = await db
    .select({ registrationId: identityProvider.registrationId, label: identityProvider.label })
    .from(identityProvider)
    .where(inArray(identityProvider.registrationId, providerIds))
  for (const idp of idps) labels.set(idp.registrationId, idp.label)
  for (const id of providerIds) {
    if (!labels.has(id)) labels.set(id, getAuthProviderByProviderId(id)?.name ?? id)
  }
  return labels
}

async function toPeopleToAdd(rows: PersonRow[], query: string): Promise<PersonToAdd[]> {
  // People without a real email are described by how they sign in.
  const needSignIn = rows.filter((r) => !realEmail(r.email)).map((r) => r.userId)
  const accounts = needSignIn.length
    ? await db
        .select({
          userId: account.userId,
          providerId: account.providerId,
          accountId: account.accountId,
        })
        .from(account)
        .where(
          and(inArray(account.userId, needSignIn as UserId[]), ne(account.providerId, 'credential'))
        )
        .orderBy(account.createdAt)
    : []
  const labels = await providerLabels([...new Set(accounts.map((a) => a.providerId))])
  const needle = query.toLowerCase()

  return rows.map((r) => {
    const email = realEmail(r.email)
    let detail = email ?? ''
    if (!email) {
      const own = accounts.filter((a) => a.userId === r.userId)
      const chosen =
        (needle && own.find((a) => a.accountId.toLowerCase().includes(needle))) || own[0]
      if (chosen) {
        detail = `Signs in with ${labels.get(chosen.providerId) ?? chosen.providerId}`
        if (chosen.accountId) detail += ` · ${chosen.accountId}`
      }
    }
    return {
      principalId: r.principalId,
      name: r.name,
      avatarUrl: resolveUserAvatarUrl({ userImage: r.image, userImageKey: r.imageKey }),
      detail,
      status: r.role === 'admin' ? 'admin' : r.role === 'member' ? 'member' : 'portal_user',
    }
  })
}

const fullEmail = z.string().email()

/** Display name of an invite's role: the custom role's name, else Admin or Member. */
async function inviteRoleName(role: string, roleId: RoleId | null): Promise<string> {
  if (roleId) {
    const [custom] = await db
      .select({ name: roles.name })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1)
    if (custom) return custom.name
  }
  return role === 'admin' ? 'Admin' : 'Member'
}

/** Where a full email address stands for adding, or undefined when `query` is not one. */
async function lookupEmailToAdd(
  query: string,
  canSearchPeople: boolean
): Promise<EmailToAdd | undefined> {
  if (!fullEmail.safeParse(query).success) return undefined
  const address = query.toLowerCase()
  if (!realEmail(address)) return undefined

  const standing = await classifyInviteEmail(address)
  if (standing.status === 'pending_invite') {
    return {
      address,
      status: 'pending_invite',
      invitationId: standing.invitationId,
      invitedAt: standing.invitedAt.toISOString(),
      roleName: await inviteRoleName(standing.role, standing.roleId),
    }
  }
  if (standing.status === 'member') {
    return { address, status: 'member', principalId: standing.principalId }
  }
  if (canSearchPeople && standing.principalId) {
    const [candidate] = await loadTeamCandidates([standing.principalId])
    if (candidate && classifyTeamCandidate(candidate) === 'eligible') {
      return { address, status: 'portal_user', principalId: candidate.id }
    }
  }
  return { address, status: 'new' }
}
