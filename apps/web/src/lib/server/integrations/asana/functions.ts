/**
 * Asana-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { MemberId } from '@quackback/ids'

export interface AsanaOAuthState {
  type: 'asana_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

export interface AsanaProject {
  id: string
  name: string
}

interface AsanaIntegrationConfig {
  workspaceId?: string
  workspaceName?: string
  tokenExpiresAt?: string
}

export const getAsanaConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('asana'))) {
      throw new Error(
        'Asana platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'asana_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies AsanaOAuthState)

    return `/oauth/asana/connect?state=${encodeURIComponent(state)}`
  }
)

export const fetchAsanaProjectsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AsanaProject[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listAsanaProjects } = await import('./projects')
    const { refreshAsanaToken } = await import('./oauth')
    const { encryptSecrets } = await import('../encryption')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'asana'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Asana not connected')
    }

    const secrets = decryptSecrets<{
      accessToken: string
      refreshToken?: string
    }>(integration.secrets)

    let { accessToken } = secrets
    const cfg = (integration.config ?? {}) as AsanaIntegrationConfig

    // Refresh token if expired or about to expire (within 5 minutes)
    if (secrets.refreshToken && cfg.tokenExpiresAt) {
      const expiresAt = new Date(cfg.tokenExpiresAt).getTime()
      const bufferMs = 5 * 60 * 1000
      if (Date.now() >= expiresAt - bufferMs) {
        console.log('[Asana] Access token expired, refreshing...')
        const refreshed = await refreshAsanaToken(secrets.refreshToken)
        accessToken = refreshed.accessToken

        const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
        await db
          .update(integrations)
          .set({
            secrets: encryptSecrets({
              accessToken: refreshed.accessToken,
              refreshToken: secrets.refreshToken,
            }),
            config: { ...cfg, tokenExpiresAt: newExpiry },
            updatedAt: new Date(),
          })
          .where(eq(integrations.integrationType, 'asana'))
      }
    }

    if (!cfg.workspaceId) {
      throw new Error('Asana workspace ID not found. Please reconnect Asana.')
    }

    return listAsanaProjects(accessToken, cfg.workspaceId as string)
  }
)
