/**
 * Outgoing user-sync notification.
 *
 * Called (fire-and-forget) after dynamic segment evaluation to push
 * segment membership changes to all active integrations that implement
 * userSync.syncSegmentMembership (e.g. Segment CDP, HubSpot, etc.).
 */

import type { PrincipalId } from '@quackback/ids'
import { db, integrations, principal, user, eq, inArray } from '@/lib/server/db'
import { getIntegration, getIntegrationTypesWithSegmentSync } from './index'
import { decryptSecrets } from './encryption'

interface UserRef {
  email: string
  externalUserId?: string
}

/**
 * Notify all active user-sync integrations of segment membership changes.
 * Should be called fire-and-forget — errors are logged, not propagated.
 */
export async function notifyUserSyncIntegrations(
  segmentName: string,
  addedPrincipalIds: PrincipalId[],
  removedPrincipalIds: PrincipalId[]
): Promise<void> {
  const syncTypes = getIntegrationTypesWithSegmentSync()
  if (syncTypes.length === 0) return
  if (addedPrincipalIds.length === 0 && removedPrincipalIds.length === 0) return

  // Load all active integrations with segment sync capability in one query
  const activeIntegrations = await db.query.integrations
    .findMany({
      where: eq(integrations.status, 'active'),
      columns: { integrationType: true, config: true, secrets: true },
    })
    .then((rows) => rows.filter((r) => syncTypes.includes(r.integrationType)))

  if (activeIntegrations.length === 0) return

  // Resolve user emails for added + removed (lazy — only if needed)
  let addedUsers: UserRef[] | null = null
  let removedUsers: UserRef[] | null = null

  for (const integration of activeIntegrations) {
    const def = getIntegration(integration.integrationType)
    if (!def?.userSync?.syncSegmentMembership) continue

    const config = (integration.config ?? {}) as Record<string, unknown>
    const secrets = integration.secrets ? decryptSecrets(integration.secrets) : {}

    if (addedPrincipalIds.length > 0) {
      if (!addedUsers) addedUsers = await resolveUserRefs(addedPrincipalIds)
      if (addedUsers.length > 0) {
        await def.userSync
          .syncSegmentMembership(addedUsers, segmentName, true, config, secrets)
          .catch((err) =>
            console.error(
              `[UserSync] ${integration.integrationType} syncSegmentMembership(joined) failed:`,
              err
            )
          )
      }
    }

    if (removedPrincipalIds.length > 0) {
      if (!removedUsers) removedUsers = await resolveUserRefs(removedPrincipalIds)
      if (removedUsers.length > 0) {
        await def.userSync
          .syncSegmentMembership(removedUsers, segmentName, false, config, secrets)
          .catch((err) =>
            console.error(
              `[UserSync] ${integration.integrationType} syncSegmentMembership(left) failed:`,
              err
            )
          )
      }
    }
  }
}

/**
 * Resolve user email (and stored externalUserId) for a set of principal IDs.
 * Joins principal → user to get the email address.
 */
async function resolveUserRefs(principalIds: PrincipalId[]): Promise<UserRef[]> {
  if (principalIds.length === 0) return []

  const rows = await db
    .select({
      email: user.email,
      metadata: user.metadata,
    })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, principalIds))

  return rows.map((r) => {
    // externalUserId may be stored in metadata under a conventional key
    let externalUserId: string | undefined
    if (r.metadata) {
      try {
        const meta = JSON.parse(r.metadata) as Record<string, unknown>
        if (typeof meta._externalUserId === 'string') {
          externalUserId = meta._externalUserId
        }
      } catch {
        // ignore
      }
    }
    return { email: r.email, externalUserId }
  })
}
