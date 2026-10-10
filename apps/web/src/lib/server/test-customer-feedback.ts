import type { Actor } from '@/lib/server/policy/types'
import type { PrincipalId } from '@quackback/ids'
import {
  db,
  eq,
  principal,
  type BoardAccess,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { boardCapabilitiesForActor } from '@/lib/server/policy/posts'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { isTeamMember, type Role } from '@/lib/shared/roles'
import { knownTestOwner, rememberTestOwner } from '@/lib/server/test-data'

type TestFeedback = NonNullable<Actor['testFeedback']>

/**
 * What a teammate's test customer may do with feedback. It is a customer, so
 * board tiers and the workspace's anonymous switch apply as they would to any
 * visitor. An owner who can see private posts also lends it every board for
 * its own ideas, which is what makes a private feedback board testable.
 */
export function testFeedbackFor(
  ownerPrincipalId: PrincipalId,
  ownerPermissions: ReadonlySet<PermissionKey>
): TestFeedback {
  const canView = ownerPermissions.has(PERMISSIONS.POST_VIEW_PRIVATE)
  return {
    ownerPrincipalId,
    active: true,
    canView,
    canSubmit: canView && ownerPermissions.has(PERMISSIONS.POST_CREATE),
  }
}

/**
 * Whether this teammate's test customer could post an idea anywhere right now,
 * so "Post an idea" is offered only when it will work. Pure: the caller passes
 * the boards and the workspace's anonymous switch it already read.
 */
export function canTestCustomerPostIdea(
  ownerPrincipalId: PrincipalId,
  ownerPermissions: ReadonlySet<PermissionKey>,
  boards: ReadonlyArray<{ access: BoardAccess }>,
  allowAnonymous: boolean
): boolean {
  const actor: Actor = {
    principalId: null,
    role: 'user',
    principalType: 'anonymous',
    segmentIds: new Set(),
    testFeedback: testFeedbackFor(ownerPrincipalId, ownerPermissions),
  }
  return boards.some(
    (board) => boardCapabilitiesForActor(actor, board.access, allowAnonymous).canSubmit
  )
}

/** The durable customer marker delegates only test-idea view and creation. */
export async function resolveTestFeedbackActor(
  actor: Actor,
  executor: Database | Transaction = db
): Promise<Actor> {
  const { testFeedback: previous, ...base } = actor
  if (!actor.principalId || actor.principalType !== 'anonymous') return base
  // Ordinary visitors are the common case: a principal the process already
  // knows is not a test customer needs no read.
  if (!previous && knownTestOwner(actor.principalId) === null) return base
  const customer = await executor.query.principal.findFirst({
    where: eq(principal.id, actor.principalId),
    columns: { id: true, type: true, role: true, testOwnerPrincipalId: true },
  })
  if (customer) rememberTestOwner(customer)
  if (
    !customer?.testOwnerPrincipalId ||
    customer.type !== 'anonymous' ||
    customer.role !== 'user'
  ) {
    return previous
      ? { ...base, testFeedback: { ...previous, active: false, canView: false, canSubmit: false } }
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
    return {
      ...base,
      testFeedback: { ownerPrincipalId, active: false, canView: false, canSubmit: false },
    }
  }
  const permissions = await permissionsForPrincipal(ownerPrincipalId, owner.role as Role, executor)
  return { ...base, testFeedback: testFeedbackFor(ownerPrincipalId, permissions) }
}
