/**
 * Choosing the repository GitHub sync serves.
 *
 * One repository is selectable for now. It is stored twice on purpose: as the
 * connection's single `repo` destination, which owns the repository's webhook
 * and signing secret, and as `config.channelId`, the default repository new
 * issues are created in (and what older app versions read). Switching moves
 * the webhook with the selection; before destinations existed, changing the
 * repository left the hook on the old one and the new one received nothing.
 */
import { db, eq, and, sql, integrations, integrationDestinations } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { getIntegrationAuth } from '@/lib/server/integrations/token-refresh'
import {
  ensureDestinations,
  listDestinations,
  registerDestinationWebhook,
  unregisterDestinationWebhooks,
  recordDestinationError,
} from '@/lib/server/integrations/destinations'
import {
  recordIntegrationLastError,
  clearIntegrationLastError,
} from '@/lib/server/integrations/webhook-registration'
import {
  getActiveGitHubIntegration,
  getLiveGitHubConnectionAccount,
} from '@/lib/server/domains/channel-accounts/github-connection'
import { listGitHubRepos } from '@/integrations/github/server/repos'

const log = logger.child({ component: 'github-repository' })

/**
 * Point GitHub sync at `repository`, which must be one the connection can
 * see. A no-op when it is already the selection. Otherwise the old
 * repository's webhook is removed, its row replaced (keeping its settings),
 * and the new repository's webhook registered when status sync or the inbox
 * channel listens to it. A registration failure does not undo the switch: it
 * is recorded on the repository, where the settings page offers a repair.
 */
export async function setGitHubRepository(repository: string): Promise<void> {
  const integration = await getActiveGitHubIntegration()
  if (!integration?.secrets) {
    throw new ValidationError('INTEGRATION_UNAVAILABLE', 'Connect GitHub first')
  }
  const { accessToken } = await getIntegrationAuth(integration.id)
  if (!accessToken) {
    throw new ValidationError('INTEGRATION_UNAVAILABLE', 'Reconnect GitHub to choose a repository')
  }

  const wanted = repository.toLowerCase()
  const chosen = (await listGitHubRepos(accessToken)).find(
    (repo) => repo.fullName.toLowerCase() === wanted
  )
  if (!chosen) {
    throw new ValidationError(
      'INVALID_DESTINATION',
      'Choose a repository this GitHub connection can access'
    )
  }

  await ensureDestinations(integration)
  const current = await listDestinations(integration.id, 'repo')
  if (current.length === 1 && current[0].externalId.toLowerCase() === wanted) return

  const inboxEnabled = !!(await getLiveGitHubConnectionAccount())
  await unregisterDestinationWebhooks({ integration, accessToken })
  const created = await db.transaction(async (tx) => {
    await tx
      .delete(integrationDestinations)
      .where(
        and(
          eq(integrationDestinations.integrationId, integration.id),
          eq(integrationDestinations.kind, 'repo')
        )
      )
    const [row] = await tx
      .insert(integrationDestinations)
      .values({
        integrationId: integration.id,
        kind: 'repo',
        externalId: chosen.fullName,
        externalKey: String(chosen.id),
        config: current[0]?.config ?? { inboundMode: inboxEnabled ? 'conversations' : 'off' },
      })
      .returning()
    await tx
      .update(integrations)
      .set({
        config: sql`jsonb_set(${integrations.config}, '{channelId}', to_jsonb(${chosen.fullName}::text))`,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integration.id))
    return row
  })
  // Issue creation reads the connection config through the mapping cache.
  const { cacheDel, CACHE_KEYS } = await import('@/lib/server/cache')
  await cacheDel(CACHE_KEYS.INTEGRATION_MAPPINGS)

  const config = (integration.config ?? {}) as Record<string, unknown>
  if (!config.statusSyncEnabled && !inboxEnabled) return
  try {
    await registerDestinationWebhook({ integration, destination: created, accessToken })
    await clearIntegrationLastError(integration.id)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    log.warn({ err }, 'github repository webhook registration failed')
    await recordDestinationError(created.id, `Failed to register webhook: ${raw}`)
    await recordIntegrationLastError(
      integration.id,
      `Failed to register webhook for ${chosen.fullName}: ${raw}`
    )
  }
}
