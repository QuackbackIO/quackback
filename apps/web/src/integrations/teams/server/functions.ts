/**
 * Teams-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface TeamsOAuthState {
  type: 'teams_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
}

export interface TeamsTeam {
  id: string
  name: string
}

export interface TeamsChannel {
  id: string
  name: string
  isPrivate: boolean
}

export const getTeamsConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('teams'))) {
      throw new Error(
        'Teams platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'teams_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies TeamsOAuthState)

    return `/oauth/teams/connect?state=${encodeURIComponent(state)}`
  }
)

export const fetchTeamsTeamsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TeamsTeam[]> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { listTeams } = await import('@/integrations/teams/server/channels')

    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'teams'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Teams not connected')
    }

    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const accessToken = await getValidAccessToken(integration.id)
    return listTeams(accessToken)
  }
)

export const fetchTeamsChannelsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ teamId: z.string() }))
  .handler(async ({ data }): Promise<TeamsChannel[]> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { listTeamsChannels } = await import('@/integrations/teams/server/channels')

    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'teams'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Teams not connected')
    }

    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const accessToken = await getValidAccessToken(integration.id)
    return listTeamsChannels(accessToken, data.teamId)
  })
