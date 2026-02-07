/**
 * Jira-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MemberId } from '@quackback/ids'

export interface JiraOAuthState {
  type: 'jira_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

export interface JiraProject {
  id: string
  name: string
  key: string
}

export interface JiraIssueType {
  id: string
  name: string
  subtask: boolean
}

interface JiraIntegrationConfig {
  cloudId?: string
  siteUrl?: string
  workspaceName?: string
  tokenExpiresAt?: string
}

export const getJiraConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('jira'))) {
      throw new Error(
        'Jira platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'jira_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies JiraOAuthState)

    return `/oauth/jira/connect?state=${encodeURIComponent(state)}`
  }
)

/** Refresh Jira token if expired or about to expire (within 5 minutes). Returns current access token. */
async function getJiraAccessToken(integration: { secrets: unknown; config: unknown }) {
  const { decryptSecrets, encryptSecrets } = await import('../encryption')
  const { db, integrations, eq } = await import('@/lib/server/db')

  const secrets = decryptSecrets<{ accessToken: string; refreshToken?: string }>(
    integration.secrets as string
  )
  const cfg = (integration.config ?? {}) as JiraIntegrationConfig

  if (secrets.refreshToken && cfg.tokenExpiresAt) {
    const expiresAt = new Date(cfg.tokenExpiresAt).getTime()
    const bufferMs = 5 * 60 * 1000
    if (Date.now() >= expiresAt - bufferMs) {
      console.log('[Jira] Access token expired, refreshing...')
      const { refreshJiraToken } = await import('./oauth')
      const refreshed = await refreshJiraToken(secrets.refreshToken)

      const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
      await db
        .update(integrations)
        .set({
          secrets: encryptSecrets({
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
          }),
          config: { ...cfg, tokenExpiresAt: newExpiry },
          updatedAt: new Date(),
        })
        .where(eq(integrations.integrationType, 'jira'))

      return refreshed.accessToken
    }
  }

  return secrets.accessToken
}

export const fetchJiraProjectsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<JiraProject[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { listJiraProjects } = await import('./projects')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'jira'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Jira not connected')
    }

    const cloudId = (integration.config as JiraIntegrationConfig)?.cloudId
    if (!cloudId) {
      throw new Error('Jira cloud ID not found in integration config')
    }

    const accessToken = await getJiraAccessToken(integration)
    return listJiraProjects(accessToken, cloudId)
  }
)

const fetchIssueTypesSchema = z.object({
  projectId: z.string().min(1),
})

export const fetchJiraIssueTypesFn = createServerFn({ method: 'POST' })
  .inputValidator(fetchIssueTypesSchema)
  .handler(async ({ data }): Promise<JiraIssueType[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { listJiraIssueTypes } = await import('./projects')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'jira'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Jira not connected')
    }

    const cloudId = (integration.config as JiraIntegrationConfig)?.cloudId
    if (!cloudId) {
      throw new Error('Jira cloud ID not found in integration config')
    }

    const accessToken = await getJiraAccessToken(integration)
    return listJiraIssueTypes(accessToken, cloudId, data.projectId)
  })
