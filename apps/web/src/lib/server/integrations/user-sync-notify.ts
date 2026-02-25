/**
 * Outgoing user-sync notification.
 *
 * Called (fire-and-forget) after dynamic segment evaluation to push
 * segment membership changes to all active integrations that implement
 * userSync.syncSegmentMembership (e.g. Segment CDP, HubSpot, etc.).
 */

import type { PrincipalId } from '@quackback/ids'
import { db, integrations, principal, user, eq, and, inArray } from '@/lib/server/db'
import { getIntegration, getIntegrationTypesWithSegmentSync } from './index'
import { decryptSecrets } from './encryption'

interface UserRef {
  email: string
  externalUserId?: string
}

export async function notifyUserSyncIntegrations(
  segmentName: string,
  addedPrincipalIds: PrincipalId[],
  removedPrincipalIds: PrincipalId[]
): Promise<void> {
  const syncTypes = getIntegrationTypesWithSegmentSync()
  if (syncTypes.length === 0) return
  if (addedPrincipalIds.length === 0 && removedPrincipalIds.length === 0) return

  const activeIntegrations = await db.query.integrations.findMany({
    where: and(eq(integrations.status, 'active'), inArray(integrations.integrationType, syncTypes)),
    columns: { integrationType: true, config: true, secrets: true },
  })
  if (activeIntegrations.length === 0) return

  const [addedUsers, removedUsers] = await Promise.all([
    resolveUserRefs(addedPrincipalIds),
    resolveUserRefs(removedPrincipalIds),
  ])

  for (const integration of activeIntegrations) {
    const def = getIntegration(integration.integrationType)
    if (!def?.userSync?.syncSegmentMembership) continue

    const config = (integration.config ?? {}) as Record<string, unknown>
    const secrets = integration.secrets ? decryptSecrets(integration.secrets) : {}
    const sync = def.userSync.syncSegmentMembership

    const calls: Promise<void>[] = []
    if (addedUsers.length > 0) {
      calls.push(sync(addedUsers, segmentName, true, config, secrets))
    }
    if (removedUsers.length > 0) {
      calls.push(sync(removedUsers, segmentName, false, config, secrets))
    }

    await Promise.allSettled(calls).then((results) => {
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error(
            `[UserSync] ${integration.integrationType} syncSegmentMembership failed:`,
            r.reason
          )
        }
      }
    })
  }
}

async function resolveUserRefs(principalIds: PrincipalId[]): Promise<UserRef[]> {
  if (principalIds.length === 0) return []

  const rows = await db
    .select({ email: user.email, metadata: user.metadata })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, principalIds))

  return rows.map((r) => ({
    email: r.email,
    externalUserId: parseExternalUserId(r.metadata),
  }))
}

function parseExternalUserId(metadata: string | null): string | undefined {
  if (!metadata) return undefined
  try {
    const meta = JSON.parse(metadata) as Record<string, unknown>
    return typeof meta._externalUserId === 'string' ? meta._externalUserId : undefined
  } catch {
    return undefined
  }
}
