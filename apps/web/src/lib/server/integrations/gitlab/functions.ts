/**
 * GitLab-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { MemberId } from '@quackback/ids'

export interface GitLabOAuthState {
  type: 'gitlab_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
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
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
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
      memberId: auth.member.id,
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
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listGitLabProjects } = await import('./projects')

    console.log(`[fn:integrations] fetchGitLabProjectsFn`)
    await requireAuth({ roles: ['admin'] })

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
    console.log(`[fn:integrations] fetchGitLabProjectsFn: ${projects.length} projects`)
    return projects
  }
)
