/**
 * HubSpot-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MemberId } from '@quackback/ids'

export interface HubSpotOAuthState {
  type: 'hubspot_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

interface HubSpotIntegrationConfig {
  workspaceName?: string
  tokenExpiresAt?: string
}

export const getHubSpotConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('hubspot'))) {
      throw new Error(
        'HubSpot platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'hubspot_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies HubSpotOAuthState)

    return `/oauth/hubspot/connect?state=${encodeURIComponent(state)}`
  }
)

export const searchHubSpotContactFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { searchHubSpotContact } = await import('./context')

    await requireAuth({ roles: ['admin', 'member'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'hubspot'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('HubSpot not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string; refreshToken?: string }>(
      integration.secrets
    )

    // HubSpot tokens expire after 30 minutes — refresh if we have a refresh token
    let { accessToken } = secrets
    if (secrets.refreshToken && integration.config) {
      const cfg = integration.config as HubSpotIntegrationConfig
      if (cfg.tokenExpiresAt && new Date(cfg.tokenExpiresAt) < new Date()) {
        const { refreshHubSpotToken } = await import('./oauth')
        const { encryptSecrets } = await import('../encryption')
        const { getPlatformCredentials } =
          await import('@/lib/server/domains/platform-credentials/platform-credential.service')
        const credentials = await getPlatformCredentials('hubspot')
        const refreshed = await refreshHubSpotToken(secrets.refreshToken, credentials ?? undefined)
        accessToken = refreshed.accessToken

        // Persist refreshed tokens
        const { eq: eqOp } = await import('@/lib/server/db')
        const newSecrets = encryptSecrets({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
        })
        const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000)
        await db
          .update(integrations)
          .set({
            secrets: newSecrets,
            config: { ...cfg, tokenExpiresAt: newExpiry.toISOString() },
            updatedAt: new Date(),
          })
          .where(eqOp(integrations.integrationType, 'hubspot'))
      }
    }

    return searchHubSpotContact(accessToken, data.email)
  })
