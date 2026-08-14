/**
 * Jira-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { PrincipalId } from '@quackback/ids'
import { getJiraAccessToken, type JiraTokenConfig } from './access-token'

export interface JiraOAuthState {
  type: 'jira_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
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

type JiraIntegrationConfig = JiraTokenConfig

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
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies JiraOAuthState)

    return `/oauth/jira/connect?state=${encodeURIComponent(state)}`
  }
)

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
  .validator(fetchIssueTypesSchema)
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
