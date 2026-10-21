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
 * What a repository does with its issues while the inbox channel is live:
 * nothing, open an inbox conversation for each, or open a conversation and a
 * customer ticket paired with it (`tickets`).
 */
export const GITHUB_INBOUND_MODES = ['off', 'conversations', 'tickets'] as const
export type GitHubInboundMode = (typeof GITHUB_INBOUND_MODES)[number]

export function githubInboundMode(
  config: { inboundMode?: unknown } | null | undefined
): GitHubInboundMode {
  const mode = config?.inboundMode
  return mode === 'conversations' || mode === 'tickets' ? mode : 'off'
}

/** Whether a repository's issues come into the inbox at all (as conversations, or with tickets). */
export function githubBringsIssuesIn(
  config: { inboundMode?: unknown } | null | undefined
): boolean {
  return githubInboundMode(config) !== 'off'
}

/** The team and ticket type a `tickets`-mode repository stamps on the tickets it opens. */
export interface GitHubTicketScope {
  teamId: string | null
  ticketTypeId: string | null
}

export function githubTicketScope(
  config: { ticketScope?: unknown } | null | undefined
): GitHubTicketScope {
  const scope = (config?.ticketScope ?? {}) as Record<string, unknown>
  return {
    teamId: typeof scope.teamId === 'string' && scope.teamId ? scope.teamId : null,
    ticketTypeId:
      typeof scope.ticketTypeId === 'string' && scope.ticketTypeId ? scope.ticketTypeId : null,
  }
}

/**
 * Whether a delivery from this repository opens or updates inbox
 * conversations: it brings its issues in, and is switched on and not
 * send-only. The channel connection being live is checked separately.
 */
export function githubRepositoryIngests(
  repository: Pick<IntegrationDestination, 'config' | 'enabled'>
): boolean {
  return githubBringsIssuesIn(repository.config) && destinationReceives(repository)
}

/**
 * The events one repository's hook subscribes to: `issues` always (status
 * sync, issue lifecycle, assignees), `issue_comment` only while the inbox channel is
 * live and this repository brings its issues in (as conversations or
 * tickets). The one place a feature that needs another event per repository
 * adds it.
 */
export function githubWebhookEvents(
  repository: { inboundMode?: unknown },
  opts: { inboxLive: boolean }
): string[] {
  return opts.inboxLive && githubBringsIssuesIn(repository)
    ? ['issues', 'issue_comment']
    : ['issues']
}

/**
 * Whether anything listens to one repository's hook: status sync (every
 * repository), the inbox (a repository that brings its issues in, while the
 * channel is live), or assignee sync (a repository that has it on). All of
 * them read the `issues` events the hook always carries.
 */
export function githubHookWanted(
  repository: { inboundMode?: unknown; assigneeSync?: unknown },
  opts: { statusSync: boolean; inboxLive: boolean }
): boolean {
  return (
    opts.statusSync ||
    repository.assigneeSync === true ||
    githubWebhookEvents(repository, opts).includes('issue_comment')
  )
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
  if (repositories.some((r) => githubBringsIssuesIn(r.config))) return
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
      } else if (githubHookWanted(repository.config, { statusSync, inboxLive })) {
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
