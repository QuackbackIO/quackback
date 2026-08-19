/**
 * Blocking a person (support platform §4.6).
 *
 * A blocked principal's inbound messages are rejected and it cannot
 * re-register: the messenger visitor-send gate and the widget identify handler
 * both consult {@link isBlocked}. The email-inbound transport enforces the
 * same check at its separate ingestion boundary.
 *
 * Only end users (portal users, leads, anonymous visitors) can be blocked.
 * Guards refuse to block team members (they manage the workspace) and service
 * principals (integrations / API keys / the AI assistant) — blocking either
 * would be an own-goal, not a moderation action.
 *
 * The block travels with the person across an anonymous-to-identified merge via
 * the fill-if-empty steps in principal-repoint.ts, so signing in never sheds it.
 */
import { db, principal, eq, sql, type Principal } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'blocking' })

/** A principal that may not be blocked: team members and service principals. */
function assertBlockable(target: Principal): void {
  if (isTeamMember(target.role)) {
    throw new ForbiddenError('CANNOT_BLOCK_TEAM', 'Team members cannot be blocked.')
  }
  if (target.type === 'service') {
    throw new ForbiddenError('CANNOT_BLOCK_SERVICE', 'Service principals cannot be blocked.')
  }
}

/**
 * Whether this principal is currently blocked. The single read the enforcement
 * gates (messenger send, widget identify, email ingest) share.
 */
export async function isBlocked(principalId: PrincipalId): Promise<boolean> {
  const row = await db.query.principal.findFirst({
    columns: { blockedAt: true },
    where: eq(principal.id, principalId),
  })
  return row?.blockedAt != null
}

/** When (if ever) a principal was blocked — for the People / conversation UI. */
export async function getBlockStatus(
  principalId: PrincipalId
): Promise<{ blockedAt: string | null }> {
  const row = await db.query.principal.findFirst({
    columns: { blockedAt: true },
    where: eq(principal.id, principalId),
  })
  return { blockedAt: row?.blockedAt?.toISOString() ?? null }
}

/**
 * Block a person: reject their future messages and re-registration. Idempotent
 * on an already-blocked principal (keeps the original `blocked_by`).
 *
 * @throws NotFoundError when the principal does not exist
 * @throws ForbiddenError when the target is a team member or service principal
 */
export async function block(
  principalId: PrincipalId,
  actorPrincipalId: PrincipalId
): Promise<void> {
  const target = await db.query.principal.findFirst({ where: eq(principal.id, principalId) })
  if (!target) throw new NotFoundError('PRINCIPAL_NOT_FOUND', 'Person not found.')
  assertBlockable(target)
  if (target.blockedAt) return
  await db
    .update(principal)
    .set({ blockedAt: sql`now()`, blockedByPrincipalId: actorPrincipalId })
    .where(eq(principal.id, principalId))
  log.info({ principal_id: principalId, blocked_by: actorPrincipalId }, 'person blocked')
}

/** Unblock a person: clear the block flag and the acting-teammate reference. */
export async function unblock(principalId: PrincipalId): Promise<void> {
  await db
    .update(principal)
    .set({ blockedAt: null, blockedByPrincipalId: null })
    .where(eq(principal.id, principalId))
  log.info({ principal_id: principalId }, 'person unblocked')
}
