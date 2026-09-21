/** Membership writes and outbound operations commit together. Each person has independent recovery. */
import { randomUUID } from 'node:crypto'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { integrations, principal, eq, and, inArray, type Transaction } from '@/lib/server/db'
import { getIntegration, getIntegrationTypesWithSegmentSync } from './index'
import { queueSyncOperation } from './sync/ledger'
import { installationIdentity, syncDestination, syncOperationKey } from './sync/identity'

export async function notifyUserSyncIntegrations(
  segmentName: string,
  added: PrincipalId[],
  removed: PrincipalId[],
  options: { executor: Transaction; segmentId: SegmentId }
): Promise<void> {
  if (!added.length && !removed.length) return
  const tx = options.executor
  const types = getIntegrationTypesWithSegmentSync()
  if (!types.length) return
  const connections = await tx.query.integrations.findMany({
    where: and(eq(integrations.status, 'active'), inArray(integrations.integrationType, types)),
  })
  const revision = randomUUID()
  for (const integration of connections) {
    const config = (integration.config ?? {}) as Record<string, unknown>
    if (!config.outgoingEnabled) continue
    const installation = installationIdentity(integration)
    const destination = syncDestination(
      { segmentId: options.segmentId },
      config,
      getIntegration(integration.integrationType)
    )
    for (const [ids, joined] of [
      [added, true],
      [removed, false],
    ] as const) {
      if (!ids.length) continue
      const people = await tx
        .select({ id: principal.id, userId: principal.userId })
        .from(principal)
        .where(inArray(principal.id, [...ids]))
      for (const person of people) {
        if (!person.userId) continue
        await queueSyncOperation(
          {
            operationKey: syncOperationKey({
              installation,
              destination,
              kind: 'membership',
              sourceType: 'user',
              sourceId: person.userId,
              revision,
            }),
            integrationId: integration.id,
            installation,
            provider: integration.integrationType,
            direction: 'outbound',
            kind: 'membership',
            sourceType: 'user',
            sourceId: person.userId,
            destination,
            remoteId: `${person.userId}:${options.segmentId}`,
            payload: {
              executor: 'segment',
              data: { principalId: person.id, segmentId: options.segmentId, segmentName, joined },
            },
          },
          tx
        )
      }
    }
  }
}
