/**
 * GitHub inbox-channel connection account. Enabled = a live
 * (not soft-deleted) `channel_accounts` row with role=connection and
 * channel=github. Secrets stay on the integrations row. Which repositories
 * bring their issues in is per repository (`inboundMode` on its
 * `integration_destinations` row); the connection is the one switch over all
 * of them.
 */
import {
  db,
  eq,
  and,
  isNull,
  sql,
  channelAccounts,
  integrations,
  integrationDestinations,
  type ChannelAccount,
} from '@/lib/server/db'
import type { IntegrationId, TeamId } from '@quackback/ids'
import {
  destinationReceives,
  listDestinations,
  type IntegrationDestination,
} from '@/lib/server/integrations/destinations'
import { defaultTeamId } from './channel-account.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'github-connection' })

const GITHUB_CHANNEL = 'github'

export const GITHUB_INBOX_CONNECT_COPY = 'Connect GitHub before enabling the inbox channel.'

export function githubAccessTokenPresent(
  secrets: { accessToken?: unknown } | null | undefined
): boolean {
  return typeof secrets?.accessToken === 'string' && secrets.accessToken.length > 0
}

export function githubInboxEnableDeniedReason(opts: {
  status?: string | null
  accessToken?: string | null
}): string | null {
  if (opts.status === 'paused') return 'Resume GitHub before enabling the inbox channel.'
  if (opts.status !== 'active' || !opts.accessToken) return GITHUB_INBOX_CONNECT_COPY
  return null
}

export async function getLiveGitHubConnectionAccount(): Promise<ChannelAccount | null> {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channel, GITHUB_CHANNEL),
        eq(channelAccounts.role, 'connection'),
        isNull(channelAccounts.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

export async function getGitHubConnectionAccountIncludingDeleted(): Promise<ChannelAccount | null> {
  const owningTeamId = await defaultTeamId()
  if (!owningTeamId) return null
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.owningTeamId, owningTeamId),
        eq(channelAccounts.channel, GITHUB_CHANNEL),
        eq(channelAccounts.role, 'connection')
      )
    )
    .limit(1)
  return row ?? null
}

export async function ensureGitHubConnectionAccount(
  integrationId: IntegrationId
): Promise<ChannelAccount | null> {
  const owningTeamId = await defaultTeamId()
  if (!owningTeamId) {
    log.warn({ reason: 'no_default_team' }, 'github connection account not created')
    return null
  }

  const existing = await getGitHubConnectionAccountIncludingDeleted()
  if (existing) {
    if (existing.deletedAt) {
      const [restored] = await db
        .update(channelAccounts)
        .set({
          deletedAt: null,
          config: { integrationId },
          updatedAt: new Date(),
        })
        .where(eq(channelAccounts.id, existing.id))
        .returning()
      return restored ?? existing
    }
    if ((existing.config as { integrationId?: string }).integrationId !== integrationId) {
      const [updated] = await db
        .update(channelAccounts)
        .set({ config: { integrationId }, updatedAt: new Date() })
        .where(eq(channelAccounts.id, existing.id))
        .returning()
      return updated ?? existing
    }
    return existing
  }

  const [created] = await db
    .insert(channelAccounts)
    .values({
      owningTeamId: owningTeamId as TeamId,
      channel: GITHUB_CHANNEL,
      role: 'connection',
      config: { integrationId },
    })
    .onConflictDoNothing({
      target: channelAccounts.owningTeamId,
      where: sql`role = 'connection' AND channel = 'github' AND deleted_at IS NULL`,
    })
    .returning()
  if (created) return created
  return getLiveGitHubConnectionAccount()
}

export async function disableGitHubConnectionAccount(): Promise<void> {
  const existing = await getLiveGitHubConnectionAccount()
  if (!existing) return
  await db
    .update(channelAccounts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(channelAccounts.id, existing.id))
}

/**
 * Whether a repository brings its issues and comments into the inbox. Only
 * acted on while the inbox channel connection is live. Further modes (such as
 * opening tickets) join this union as they land.
 */
export const GITHUB_INBOUND_MODES = ['off', 'conversations'] as const
export type GitHubInboundMode = (typeof GITHUB_INBOUND_MODES)[number]

export function githubInboundMode(
  config: { inboundMode?: unknown } | null | undefined
): GitHubInboundMode {
  return config?.inboundMode === 'conversations' ? 'conversations' : 'off'
}

/**
 * Whether a delivery from this repository opens or updates inbox
 * conversations: it brings its issues in, and is switched on and not
 * send-only. The channel connection being live is checked separately.
 */
export function githubRepositoryIngests(
  repository: Pick<IntegrationDestination, 'config' | 'enabled'>
): boolean {
  return githubInboundMode(repository.config) === 'conversations' && destinationReceives(repository)
}

/**
 * The events one repository's hook subscribes to: `issues` always (status
 * sync, issue lifecycle), `issue_comment` only while the inbox channel is
 * live and this repository brings its issues in. The one place a feature
 * that needs another event per repository adds it.
 */
export function githubWebhookEvents(
  repository: { inboundMode?: unknown },
  opts: { inboxLive: boolean }
): string[] {
  return opts.inboxLive && githubInboundMode(repository) === 'conversations'
    ? ['issues', 'issue_comment']
    : ['issues']
}

/**
 * Turning the inbox channel on with no repository bringing issues in opts
 * the default repository in (the oldest one when there is no default), so a
 * single-repository install keeps working with the one switch it always had.
 */
export async function optInDefaultGitHubRepository(integration: {
  id: IntegrationId
  config: unknown
}): Promise<void> {
  const repositories = await listDestinations(integration.id, 'repo')
  if (repositories.some((r) => githubInboundMode(r.config) === 'conversations')) return
  const channelId = (integration.config as Record<string, unknown> | null)?.channelId
  const chosen =
    repositories.find(
      (r) => typeof channelId === 'string' && r.externalId.toLowerCase() === channelId.toLowerCase()
    ) ?? repositories[0]
  if (!chosen) return
  await db
    .update(integrationDestinations)
    .set({
      config: sql`${integrationDestinations.config} || '{"inboundMode": "conversations"}'::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(integrationDestinations.id, chosen.id))
}

export async function getActiveGitHubIntegration() {
  return db.query.integrations.findFirst({
    where: and(eq(integrations.integrationType, 'github'), eq(integrations.status, 'active')),
  })
}

/**
 * Bring every enabled repository's hook (or only `destinationId`'s) in line
 * with the events it needs (see `githubWebhookEvents`): patch a registered
 * hook, register one where something listens and none exists. Each
 * repository's failure is recorded on that repository; any failure also
 * writes `integrations.lastError` and rethrows so the caller can surface
 * Attention without rolling back the switch that asked for it.
 */
export async function syncGitHubWebhookEvents(destinationId?: string): Promise<void> {
  const integration = await getActiveGitHubIntegration()
  if (!integration?.secrets) return

  const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
  const accessToken = decryptSecrets<{ accessToken?: string }>(integration.secrets).accessToken
  if (!accessToken) return

  const {
    generateWebhookSecret,
    buildWebhookCallbackUrl,
    recordIntegrationLastError,
    clearIntegrationLastError,
  } = await import('@/lib/server/integrations/webhook-registration')
  const {
    ensureDestinations,
    readDestinationSecret,
    writeDestinationWebhook,
    registerDestinationWebhook,
    recordDestinationError,
    clearDestinationError,
  } = await import('@/lib/server/integrations/destinations')
  const { patchGitHubWebhook } = await import('@/integrations/github/server/webhook-registration')

  await ensureDestinations(integration)
  const repositories = (await listDestinations(integration.id, 'repo')).filter(
    (r) => r.enabled && (!destinationId || r.id === destinationId)
  )
  if (repositories.length === 0) return

  const inboxLive = !!(await getLiveGitHubConnectionAccount())
  const statusSync = !!(integration.config as Record<string, unknown>).statusSyncEnabled
  const callbackUrl = buildWebhookCallbackUrl('github')
  const failures: string[] = []
  for (const repository of repositories) {
    const events = githubWebhookEvents(repository.config, { inboxLive })
    try {
      if (repository.externalWebhookId) {
        const secret = readDestinationSecret(repository) ?? generateWebhookSecret()
        await patchGitHubWebhook(
          accessToken,
          repository.externalId,
          repository.externalWebhookId,
          events,
          callbackUrl,
          secret
        )
        await writeDestinationWebhook(repository.id, {
          secret,
          externalWebhookId: repository.externalWebhookId,
          events,
        })
      } else if (statusSync || events.includes('issue_comment')) {
        // Registration finds and patches a hook GitHub already has at this URL.
        await registerDestinationWebhook({ integration, destination: repository, accessToken })
      }
      await clearDestinationError(repository.id)
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      failures.push(`${repository.externalId}: ${raw}`)
      await recordDestinationError(repository.id, `Webhook update failed: ${raw}`).catch(() => {})
    }
  }

  if (failures.length > 0) {
    const message = `Webhook update failed: ${failures.join('; ')}`
    await recordIntegrationLastError(integration.id, message).catch(() => {})
    throw new Error(message)
  }
  await clearIntegrationLastError(integration.id)
}
