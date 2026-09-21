/**
 * Linear-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface LinearOAuthState {
  type: 'linear_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
}

export interface LinearTeam {
  id: string
  name: string
  key: string
}

export const getLinearConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('linear'))) {
      throw new Error(
        'Linear platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'linear_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies LinearOAuthState)

    return `/oauth/linear/connect?state=${encodeURIComponent(state)}`
  }
)

export const fetchLinearTeamsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LinearTeam[]> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const { listLinearTeams } = await import('@/integrations/linear/server/teams')

    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'linear'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Linear not connected')
    }

    const accessToken = await getValidAccessToken(integration.id)

    return listLinearTeams(accessToken)
  }
)
