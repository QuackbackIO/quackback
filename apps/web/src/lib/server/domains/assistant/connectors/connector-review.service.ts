/**
 * Reviewing a connector's tool contracts.
 *
 * Separate from the CRUD because it is a different kind of write: it changes
 * nothing about what the connector is, only which contracts a teammate has
 * looked at, and it is guarded by the catalog revision rather than the policy
 * version.
 */
import { and, eq } from 'drizzle-orm'
import { db as defaultDb, connectors } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { ConnectorId, PrincipalId } from '@quackback/ids'
import { ConflictError } from '@/lib/shared/errors'
import { reviewToolContracts } from './catalog-review'
import { effectiveConnectorPolicyState } from './connector-policy-state'
import { getConnector, type ConnectorRow } from './connectors.service'

/**
 * Mark tools reviewed at the contract the reviewer was actually shown.
 *
 * The catalog revision is the guard: a discovery that added, removed or
 * changed a tool moves it, so a page loaded before that refresh cannot approve
 * contracts it never displayed. A review is not a policy edit, so it leaves
 * the policy version alone and a colleague editing permissions in another tab
 * keeps a valid base.
 */
export async function reviewConnectorTools(
  id: ConnectorId,
  input: { toolNames: readonly string[]; expectedCatalogRevision: number },
  reviewedByPrincipalId: PrincipalId | null,
  execDb: Executor = defaultDb
): Promise<ConnectorRow | null> {
  const existing = await getConnector(id, execDb)
  if (!existing) return null
  if (existing.catalogRevision !== input.expectedCatalogRevision) {
    throw new ConflictError(
      'CONNECTOR_CATALOG_CONFLICT',
      'This connection was refreshed while you were reviewing it. Reload to see what changed.'
    )
  }
  const state = effectiveConnectorPolicyState(existing)
  const toolReviews = reviewToolContracts({
    tools: existing.tools,
    reviews: state.toolReviews,
    toolNames: input.toolNames,
    catalogRevision: existing.catalogRevision,
    principalId: reviewedByPrincipalId,
  })
  const [row] = await execDb
    .update(connectors)
    .set({ toolReviews, profilePolicies: state.profilePolicies, updatedAt: new Date() })
    .where(
      and(eq(connectors.id, id), eq(connectors.catalogRevision, input.expectedCatalogRevision))
    )
    .returning()
  if (!row) {
    throw new ConflictError(
      'CONNECTOR_CATALOG_CONFLICT',
      'This connection was refreshed while you were reviewing it. Reload to see what changed.'
    )
  }
  return row
}
