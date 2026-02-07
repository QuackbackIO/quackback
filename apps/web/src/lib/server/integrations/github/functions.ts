/**
 * GitHub-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { MemberId } from '@quackback/ids'

export interface GitHubOAuthState {
  type: 'github_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

export interface GitHubRepo {
  id: number
  fullName: string
  private: boolean
}

export const getGitHubConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('github'))) {
      throw new Error(
        'GitHub platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'github_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies GitHubOAuthState)

    return `/oauth/github/connect?state=${encodeURIComponent(state)}`
  }
)

export const fetchGitHubReposFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GitHubRepo[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listGitHubRepos } = await import('./repos')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('GitHub not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    return listGitHubRepos(secrets.accessToken)
  }
)
