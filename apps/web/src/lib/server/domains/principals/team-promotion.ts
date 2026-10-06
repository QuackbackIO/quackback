/**
 * Who can join the team straight from the portal, and the write that moves
 * them. Shared by updateMemberRole (single row, REST PATCH) and the batch
 * add-people path so the two can never disagree about eligibility.
 *
 * Eligible means a real person who has signed in: an identified human
 * principal (type 'user' with a user row) on the portal tier whose user holds
 * a provider account link or a portal/dashboard session. Anonymous visitors,
 * leads, contacts created by an admin or import that never signed in,
 * widget-only identities, service and support principals are never promoted
 * this way; a person with a real email can still be invited by email.
 */
import {
  account,
  and,
  db,
  eq,
  inArray,
  principal,
  session,
  sql,
  user,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { PrincipalId, RoleId, UserId } from '@quackback/ids'
import { ConflictError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { setPrincipalRole } from './principal.factory'

/**
 * SQL predicate over the outer query's `principal.user_id`: the user has
 * signed in, through a provider account link or a non-widget session.
 */
export function hasSignedInSql() {
  return sql<boolean>`(
    EXISTS (SELECT 1 FROM ${account} WHERE ${account.userId} = ${principal.userId})
    OR EXISTS (
      SELECT 1 FROM ${session}
      WHERE ${session.userId} = ${principal.userId} AND ${session.scope} <> 'widget'
    )
  )`
}

export interface TeamCandidate {
  id: PrincipalId
  userId: UserId | null
  role: string
  type: string
  name: string
  email: string | null
  signedIn: boolean
}

/** Load principals with what eligibility needs, in one query. */
export async function loadTeamCandidates(
  ids: readonly PrincipalId[],
  executor: Database | Transaction = db
): Promise<TeamCandidate[]> {
  if (ids.length === 0) return []
  const rows = await executor
    .select({
      id: principal.id,
      userId: principal.userId,
      role: principal.role,
      type: principal.type,
      name: user.name,
      displayName: principal.displayName,
      email: user.email,
      signedIn: hasSignedInSql(),
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(inArray(principal.id, [...ids]))
  return rows.map((r) => ({
    id: r.id as PrincipalId,
    userId: (r.userId as UserId | null) ?? null,
    role: r.role,
    type: r.type,
    name: r.name ?? r.displayName ?? '',
    email: r.email,
    signedIn: Boolean(r.signedIn),
  }))
}

export type CandidateVerdict = 'teammate' | 'eligible' | 'not_signed_in' | 'not_a_person'

/** Where a principal stands for joining the team. */
export function classifyTeamCandidate(candidate: TeamCandidate): CandidateVerdict {
  if (candidate.type !== 'user' || !candidate.userId) return 'not_a_person'
  if (isTeamMember(candidate.role)) return 'teammate'
  if (candidate.role !== 'user') return 'not_a_person'
  return candidate.signedIn ? 'eligible' : 'not_signed_in'
}

/**
 * Promote portal users to `role` inside the caller's transaction. Re-reads the
 * rows under FOR UPDATE so a concurrent change between validation and write
 * refuses the whole request rather than half-applying it. Returns the cache
 * keys to bust after commit.
 */
export async function promotePortalUsers(
  tx: Transaction,
  targets: ReadonlyArray<{ id: PrincipalId; userId: UserId | null }>,
  role: 'admin' | 'member',
  opts: { assignRoleId?: RoleId; grantedBy: PrincipalId }
): Promise<string[]> {
  if (targets.length === 0) return []
  const ids = targets.map((t) => t.id)
  const locked = await tx
    .select({ id: principal.id })
    .from(principal)
    .where(and(inArray(principal.id, ids), eq(principal.type, 'user'), eq(principal.role, 'user')))
    .for('update')
  if (locked.length !== ids.length) {
    throw new ConflictError(
      'ALREADY_MEMBER',
      'Someone in this request changed while it was being saved. Refresh and try again.'
    )
  }

  const keys: string[] = []
  for (const target of targets) {
    const { cacheKeysToBust } = await setPrincipalRole({ principalId: target.id }, role, {
      executor: tx,
      knownUserId: target.userId,
      guards: { onlyType: 'user', onlyRole: 'user' },
      assignRoleId: opts.assignRoleId,
      assignGrantedBy: opts.grantedBy,
    })
    keys.push(...cacheKeysToBust)
  }
  return keys
}
