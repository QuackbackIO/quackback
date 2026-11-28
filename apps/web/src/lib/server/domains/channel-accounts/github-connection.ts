/**
 * GitHub inbox-channel connection account. Enabled = a live
 * (not soft-deleted) `channel_accounts` row with role=connection and
 * channel=github. Secrets stay on the integrations row.
 */
import {
  db,
  eq,
  and,
  isNull,
  sql,
  channelAccounts,
  integrations,
  type ChannelAccount,
} from '@/lib/server/db'
import type { IntegrationId, TeamId } from '@quackback/ids'
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

export function githubWebhookEvents(inboxEnabled: boolean): string[] {
  return inboxEnabled ? ['issues', 'issue_comment'] : ['issues']
}

export async function getActiveGitHubIntegration() {
  return db.query.integrations.findFirst({
    where: and(eq(integrations.integrationType, 'github'), eq(integrations.status, 'active')),
  })
}

/**
 * Ensure every enabled repository's hook listens for the events implied by
 * current inbox state: patch a registered hook, register one where missing.
 * Each repository's failure is recorded on that repository; any failure also
 * writes `integrations.lastError` and rethrows so the caller can surface
 * Attention without rolling back the account toggle.
 */
export async function syncGitHubWebhookEvents(): Promise<void> {
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
    listDestinations,
    readDestinationSecret,
    writeDestinationWebhook,
    registerDestinationWebhook,
    recordDestinationError,
    clearDestinationError,
  } = await import('@/lib/server/integrations/destinations')
  const { patchGitHubWebhook } = await import('@/integrations/github/server/webhook-registration')

  await ensureDestinations(integration)
  const repositories = (await listDestinations(integration.id, 'repo')).filter((r) => r.enabled)
  if (repositories.length === 0) return

  const events = githubWebhookEvents(!!(await getLiveGitHubConnectionAccount()))
  const callbackUrl = buildWebhookCallbackUrl('github')
  const failures: string[] = []
  for (const repository of repositories) {
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
      } else {
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
