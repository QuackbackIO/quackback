/**
 * Who can join the team straight from the portal, and the write that moves
 * them. Shared by updateMemberRole (single row, REST PATCH) and the batch
 * add-people path so the two can never disagree about eligibility.
 *
 * Eligible means a real person who has signed in: an identified human
 * principal (type 'user' with a user row) on the portal tier whose user has
 * signed in (see hasSignedInSql). Anonymous visitors,
 * leads, contacts created by an admin or import that never signed in,
 * widget-only identities, service and support principals are never promoted
 * this way; a person with a real email can still be invited by email.
 */
import {
  account,
  and,
  auditLog,
  db,
  eq,
  inArray,
  invitation,
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
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'team-promotion' })

/**
 * SQL predicate over the outer query's `principal.user_id`: the user has
 * signed in. Any one of three records proves it:
 *  - a provider account link (OAuth, OIDC, password), which outlives sessions;
 *  - a non-widget session, while one is live;
 *  - a recorded `auth.signin.success` that was not an anonymous widget mint.
 *    Email sign-ins (magic link, one-time code) create no account row, and
 *    signing out deletes the session, so this audit row, written for every
 *    sign-in method, is what keeps them eligible (kept for the audit
 *    retention window).
 * Admin-created or imported contacts and widget-only identities have none.
 */
export function hasSignedInSql() {
  return sql<boolean>`(
    EXISTS (SELECT 1 FROM ${account} WHERE ${account.userId} = ${principal.userId})
    OR EXISTS (
      SELECT 1 FROM ${session}
      WHERE ${session.userId} = ${principal.userId} AND ${session.scope} <> 'widget'
    )
    OR EXISTS (
      SELECT 1 FROM ${auditLog}
      WHERE ${auditLog.actorUserId} = ${principal.userId}
        AND ${auditLog.eventType} = 'auth.signin.success'
        AND coalesce(${auditLog.metadata}->>'method', '') <> 'anonymous'
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

/**
 * Retire the pending team invitations addressed to these users' real emails,
 * inside the caller's transaction, before they join the team directly: an
 * invite left pending would keep holding a seat and could later be accepted
 * with a different role. The invite's seat is freed in the same write, so the
 * person's direct add reuses it. Returns the retired invites' magic-link
 * tokens for the caller to revoke after commit.
 */
export async function retirePendingInvitesFor(
  tx: Transaction,
  userIds: readonly UserId[]
): Promise<string[]> {
  if (userIds.length === 0) return []
  const retired = await tx
    .update(invitation)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(invitation.kind, 'team'),
        eq(invitation.status, 'pending'),
        sql`lower(${invitation.email}) IN (
          SELECT lower(${user.email}) FROM ${user}
          WHERE ${inArray(user.id, [...userIds])} AND ${user.email} IS NOT NULL
        )`
      )
    )
    .returning({ magicLinkTokens: invitation.magicLinkTokens })
  return retired.flatMap((r) => r.magicLinkTokens ?? [])
}

/** Best-effort revoke of retired invite links after commit. */
export async function revokeRetiredInviteTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  try {
    const { revokeMagicLinkTokens } = await import('@/lib/server/auth/magic-link-mint')
    await revokeMagicLinkTokens(tokens)
  } catch (error) {
    log.error({ err: error }, 'revoking retired invite links failed')
  }
}
