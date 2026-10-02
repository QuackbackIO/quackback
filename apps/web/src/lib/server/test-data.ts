import { db, principal, eq, type Database, type Transaction } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { stripTestAttributes } from '@/lib/shared/test-attributes'
export {
  isTestRecord,
  notTestRecord,
  notTestPrincipal,
  notTestConversation,
  notTestTicket,
} from '@/lib/server/db'

export async function isTestCustomer(principalId: PrincipalId): Promise<boolean> {
  const row = await db.query.principal.findFirst({
    where: eq(principal.id, principalId),
    columns: { testOwnerPrincipalId: true },
  })
  return !!row?.testOwnerPrincipalId
}

/** Only the stored identity and the server's ingress seam decide test status. */
export async function deriveTestAttributes(
  principalId: PrincipalId,
  attributes: Record<string, unknown> | null | undefined,
  visitorIngress: boolean,
  executor: Database | Transaction = db
): Promise<Record<string, unknown>> {
  const safe = stripTestAttributes(attributes)
  const identity = await executor.query.principal.findFirst({
    where: eq(principal.id, principalId),
    columns: { testOwnerPrincipalId: true, type: true, role: true },
  })
  const owner =
    identity?.testOwnerPrincipalId ??
    (visitorIngress && identity?.type === 'user' && isTeamMember(identity.role)
      ? principalId
      : null)
  return owner ? { ...safe, test: true, testOwnerPrincipalId: owner } : safe
}
