import type { Actor } from '@/lib/server/policy/types'
import { db, eq, principal, type Database, type Transaction } from '@/lib/server/db'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isTeamMember, type Role } from '@/lib/shared/roles'

/** The durable customer marker delegates only test-idea view and creation. */
export async function resolveTestFeedbackActor(
  actor: Actor,
  executor: Database | Transaction = db
): Promise<Actor> {
  const { testFeedback: previous, ...base } = actor
  if (!actor.principalId || actor.principalType !== 'anonymous') return base
  const customer = await executor.query.principal.findFirst({
    where: eq(principal.id, actor.principalId),
    columns: { type: true, role: true, testOwnerPrincipalId: true },
  })
  if (
    !customer?.testOwnerPrincipalId ||
    customer.type !== 'anonymous' ||
    customer.role !== 'user'
  ) {
    return previous
      ? { ...base, testFeedback: { ...previous, canView: false, canSubmit: false } }
      : base
  }
  const ownerPrincipalId = customer.testOwnerPrincipalId
  const owner = await executor.query.principal.findFirst({
    where: eq(principal.id, ownerPrincipalId),
    columns: { userId: true, type: true, role: true, testOwnerPrincipalId: true },
  })
  if (
    !owner?.userId ||
    owner.type !== 'user' ||
    !isTeamMember(owner.role) ||
    owner.testOwnerPrincipalId
  ) {
    return { ...base, testFeedback: { ownerPrincipalId, canView: false, canSubmit: false } }
  }
  const permissions = await permissionsForPrincipal(ownerPrincipalId, owner.role as Role, executor)
  const canView = permissions.has(PERMISSIONS.POST_VIEW_PRIVATE)
  return {
    ...base,
    testFeedback: {
      ownerPrincipalId,
      canView,
      canSubmit: canView && permissions.has(PERMISSIONS.POST_CREATE),
    },
  }
}
