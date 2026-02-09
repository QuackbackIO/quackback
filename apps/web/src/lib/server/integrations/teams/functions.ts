/**
 * Teams-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MemberId } from '@quackback/ids'

export interface TeamsOAuthState {
  type: 'teams_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
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

interface TeamsIntegrationConfig {
  workspaceName?: string
  tokenExpiresAt?: string
}

export const getTeamsConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
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
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies TeamsOAuthState)

    return `/oauth/teams/connect?state=${encodeURIComponent(state)}`
  }
)

/** Refresh Teams token if expired or about to expire (within 5 minutes). Returns current access token. */
async function getTeamsAccessToken(integration: { secrets: unknown; config: unknown }) {
  const { decryptSecrets, encryptSecrets } = await import('../encryption')
  const { db, integrations, eq } = await import('@/lib/server/db')

  const secrets = decryptSecrets<{ accessToken: string; refreshToken?: string }>(
    integration.secrets as string
  )
  const cfg = (integration.config ?? {}) as TeamsIntegrationConfig

  if (secrets.refreshToken && cfg.tokenExpiresAt) {
    const expiresAt = new Date(cfg.tokenExpiresAt).getTime()
    const bufferMs = 5 * 60 * 1000
    if (Date.now() >= expiresAt - bufferMs) {
      console.log('[Teams] Access token expired, refreshing...')
      const { refreshTeamsToken } = await import('./oauth')
      const { getPlatformCredentials } =
        await import('@/lib/server/domains/platform-credentials/platform-credential.service')
      const credentials = await getPlatformCredentials('teams')
      const refreshed = await refreshTeamsToken(secrets.refreshToken, credentials ?? undefined)

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
        .where(eq(integrations.integrationType, 'teams'))

      return refreshed.accessToken
    }
  }

  return secrets.accessToken
}

export const fetchTeamsTeamsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TeamsTeam[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { listTeams } = await import('./channels')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'teams'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Teams not connected')
    }

    const accessToken = await getTeamsAccessToken(integration)
    return listTeams(accessToken)
  }
)

export const fetchTeamsChannelsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ teamId: z.string() }))
  .handler(async ({ data }): Promise<TeamsChannel[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { listTeamsChannels } = await import('./channels')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'teams'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Teams not connected')
    }

    const accessToken = await getTeamsAccessToken(integration)
    return listTeamsChannels(accessToken, data.teamId)
  })
