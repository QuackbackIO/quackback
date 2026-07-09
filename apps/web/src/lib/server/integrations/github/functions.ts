/**
 * GitHub-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { PrincipalId, IntegrationId } from '@quackback/ids'

export interface GitHubOAuthState {
  type: 'github_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
  /** 'new' = create new integration, 'reconnect' = update existing */
  intent?: 'new' | 'reconnect'
  /** Integration ID to reconnect (when intent === 'reconnect') */
  integrationId?: string
  /** Pre-auth fields (e.g., selected repo) */
  preAuthFields?: Record<string, string>
}

export interface GitHubRepo {
  id: number
  fullName: string
  private: boolean
}

export const getGitHubConnectUrl = createServerFn({ method: 'GET' })
  .inputValidator(
    z
      .object({
        intent: z.enum(['new', 'reconnect']).optional(),
        integrationId: z.string().optional(),
        repoFullName: z.string().optional(),
      })
      .optional()
  )
  .handler(async ({ data }): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq, and } = await import('@/lib/server/db')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { getOAuthReturnDomain } = await import('@/lib/server/integrations/oauth')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('github'))) {
      throw new Error(
        'GitHub platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = getOAuthReturnDomain()

    if (data?.intent === 'reconnect') {
      if (!data.integrationId) {
        throw new Error('GitHub integration ID is required to reconnect')
      }

      const integration = await db.query.integrations.findFirst({
        where: and(
          eq(integrations.id, data.integrationId as IntegrationId),
          eq(integrations.integrationType, 'github')
        ),
        columns: { id: true },
      })

      if (!integration) {
        throw new Error('GitHub integration not found')
      }
    }

    const state = signOAuthState({
      type: 'github_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
      intent: data?.intent,
      integrationId: data?.integrationId,
      preAuthFields: data?.repoFullName ? { channelId: data.repoFullName } : undefined,
    } satisfies GitHubOAuthState)

    return `/oauth/github/connect?state=${encodeURIComponent(state)}`
  })

export const fetchGitHubReposFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ integrationId: z.string().optional() }).optional())
  .handler(async ({ data }): Promise<GitHubRepo[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq, and, sql } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { GitHubApiError, listGitHubRepos } = await import('./repos')

    await requireAuth({ roles: ['admin'] })

    let integration
    if (data?.integrationId) {
      integration = await db.query.integrations.findFirst({
        where: and(
          eq(integrations.id, data.integrationId as IntegrationId),
          eq(integrations.integrationType, 'github')
        ),
      })
    } else {
      // Fall back to any active GitHub integration
      integration = await db.query.integrations.findFirst({
        where: and(eq(integrations.integrationType, 'github'), eq(integrations.status, 'active')),
      })
    }

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('GitHub not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    try {
      const repos = await listGitHubRepos(secrets.accessToken)
      if (integration.lastError) {
        await db
          .update(integrations)
          .set({ lastError: null, lastErrorAt: null, errorCount: 0, updatedAt: new Date() })
          .where(eq(integrations.id, integration.id))
      }
      return repos
    } catch (err) {
      const message =
        err instanceof GitHubApiError && err.status === 401
          ? 'GitHub authorization failed. Reconnect this repository to refresh access.'
          : err instanceof GitHubApiError && err.status === 403
            ? 'GitHub rejected access. Reconnect this repository and confirm repository permissions.'
            : err instanceof Error
              ? err.message
              : 'Failed to load GitHub repositories.'

      await db
        .update(integrations)
        .set({
          lastError: message,
          lastErrorAt: new Date(),
          errorCount: sql`${integrations.errorCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, integration.id))

      throw new Error(message, { cause: err })
    }
  })

/**
 * Fetch all GitHub integrations with configs and event mappings.
 */
export const fetchGitHubIntegrationsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../../functions/auth-helpers')
  const { db, integrations, eq } = await import('@/lib/server/db')

  await requireAuth({ roles: ['admin'] })

  const { hasPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const { getIntegration } = await import('@/lib/server/integrations')
  const definition = getIntegration('github')
  const platformCredentialFields = definition?.platformCredentials ?? []
  const platformCredentialsConfigured =
    platformCredentialFields.length === 0 || (await hasPlatformCredentials('github'))

  const allGithub = await db.query.integrations.findMany({
    where: eq(integrations.integrationType, 'github'),
    with: { eventMappings: true },
    orderBy: (int, { desc }) => [desc(int.connectedAt)],
  })
  await repairGitHubSyncConfiguration(allGithub)

  const connections = allGithub.map((int) => {
    const config = (int.config ?? {}) as Record<string, string | number | boolean | null>
    return {
      id: int.id,
      status: int.status,
      label: int.label,
      config,
      lastError: int.lastError ?? null,
      eventMappings: int.eventMappings.map((m) => ({
        id: m.id,
        eventType: m.eventType,
        enabled: m.enabled,
        filters: m.filters as Record<string, string | number | boolean | null> | null,
      })),
    }
  })

  return { connections, platformCredentialFields, platformCredentialsConfigured }
})

async function repairGitHubSyncConfiguration(
  connections: Array<{
    id: string
    status: string
    secrets: string | null
    config: unknown
  }>
): Promise<void> {
  const repairs = connections.map(async (connection) => {
    const config =
      connection.config &&
      typeof connection.config === 'object' &&
      !Array.isArray(connection.config)
        ? (connection.config as Record<string, unknown>)
        : {}

    const ownerRepo = typeof config.channelId === 'string' ? config.channelId : ''
    const webhookId = typeof config.externalWebhookId === 'string' ? config.externalWebhookId : ''
    const syncDirection = config.syncDirection ?? 'outbound'
    const needsInboundWebhook = syncDirection === 'inbound' || syncDirection === 'bidirectional'
    if (connection.status !== 'active' || !ownerRepo || !connection.secrets) {
      return
    }

    try {
      const { db, integrations, eq } = await import('@/lib/server/db')
      const { decryptSecrets } = await import('../encryption')
      const {
        ensureGitHubWebhookEvents,
        ensureGitHubWebhookForIntegration,
        GITHUB_WEBHOOK_EVENTS_VERSION,
      } = await import('./webhook-registration')
      const { ensureGitHubEventMappings } = await import('./event-mappings')
      const secrets = decryptSecrets<{ accessToken?: string }>(connection.secrets)
      if (!secrets.accessToken) return

      await ensureGitHubEventMappings({ integrationId: connection.id as IntegrationId, config })

      if (needsInboundWebhook) {
        await ensureGitHubWebhookForIntegration({
          integrationId: connection.id as IntegrationId,
          requestHeaders: getRequestHeaders(),
        })
      } else if (config.statusSyncEnabled === true && webhookId) {
        await ensureGitHubWebhookEvents(secrets.accessToken, ownerRepo, webhookId, {
          callbackUrl: (
            await import('@/lib/server/integrations/webhook-registration')
          ).buildWebhookCallbackUrl('github', { requestHeaders: getRequestHeaders() }),
          secret: typeof config.webhookSecret === 'string' ? config.webhookSecret : undefined,
        })
        await db
          .update(integrations)
          .set({
            config: { ...config, githubWebhookEventsVersion: GITHUB_WEBHOOK_EVENTS_VERSION },
            updatedAt: new Date(),
          })
          .where(eq(integrations.id, connection.id as IntegrationId))
      }
    } catch (error) {
      console.warn(
        `[GitHub] Failed to repair sync configuration for integration ${connection.id}:`,
        error
      )
    }
  })

  await Promise.allSettled(repairs)
}
