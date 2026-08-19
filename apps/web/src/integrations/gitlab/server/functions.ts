/**
 * GitLab-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface GitLabOAuthState {
  type: 'gitlab_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
}

export interface GitLabProject {
  id: string
  name: string
}

/**
 * Generate a signed OAuth connect URL for GitLab.
 */
export const getGitLabConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('gitlab'))) {
      throw new Error(
        'GitLab platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'gitlab_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies GitLabOAuthState)

    return `/oauth/gitlab/connect?state=${encodeURIComponent(state)}`
  }
)

/**
 * Fetch available GitLab projects for the connected account.
 */
export const fetchGitLabProjectsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GitLabProject[]> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
    const { listGitLabProjects } = await import('@/integrations/gitlab/server/projects')

    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'gitlab'),
    })

    if (!integration || integration.status !== 'active') {
      throw new Error('GitLab not connected')
    }

    if (!integration.secrets) {
      throw new Error('GitLab secrets missing')
    }

    const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
    if (!secrets.accessToken) {
      throw new Error('GitLab access token missing')
    }

    const projects = await listGitLabProjects(secrets.accessToken)
    return projects
  }
)
