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

function isDuplicateHookError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err)
  return /already exists|already registered|not unique|duplicate/i.test(raw)
}

/**
 * Ensure the GitHub repo hook listens for the events implied by current
 * inbox state. Failures write `integrations.lastError` and rethrow so the
 * caller can surface Attention without rolling back the account toggle.
 */
export async function syncGitHubWebhookEvents(): Promise<void> {
  const integration = await getActiveGitHubIntegration()
  if (!integration) return
  const config = (integration.config ?? {}) as Record<string, unknown>
  const ownerRepo = config.channelId as string | undefined
  if (!ownerRepo) return
  if (!integration.secrets) return

  const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
  const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
  const accessToken = secrets.accessToken
  if (!accessToken) return

  const {
    generateWebhookSecret,
    buildWebhookCallbackUrl,
    storeWebhookIds,
    recordIntegrationLastError,
    clearIntegrationLastError,
  } = await import('@/lib/server/integrations/webhook-registration')
  const { registerGitHubWebhook, patchGitHubWebhook, findGitHubWebhookByUrl } =
    await import('@/integrations/github/server/webhook-registration')

  const inboxEnabled = !!(await getLiveGitHubConnectionAccount())
  const events = githubWebhookEvents(inboxEnabled)
  const callbackUrl = buildWebhookCallbackUrl('github')
  const secret = (config.webhookSecret as string | undefined) ?? generateWebhookSecret()
  let hookId = config.externalWebhookId as string | undefined

  try {
    if (!hookId) {
      try {
        const result = await registerGitHubWebhook(
          accessToken,
          ownerRepo,
          callbackUrl,
          secret,
          events
        )
        hookId = result.webhookId
      } catch (err) {
        if (!isDuplicateHookError(err)) throw err
        const existing = await findGitHubWebhookByUrl(accessToken, ownerRepo, callbackUrl)
        if (!existing) throw err
        hookId = existing
        await patchGitHubWebhook(accessToken, ownerRepo, hookId, events, callbackUrl, secret)
      }
    } else {
      await patchGitHubWebhook(accessToken, ownerRepo, hookId, events, callbackUrl, secret)
    }
    await storeWebhookIds(integration.id, secret, hookId)
    await clearIntegrationLastError(integration.id)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    await recordIntegrationLastError(integration.id, `Webhook update failed: ${raw}`).catch(
      () => {}
    )
    throw err
  }
}
