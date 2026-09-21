/**
 * HubSpot-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface HubSpotOAuthState {
  type: 'hubspot_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
}

export const getHubSpotConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
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
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies HubSpotOAuthState)

    return `/oauth/hubspot/connect?state=${encodeURIComponent(state)}`
  }
)

export const searchHubSpotContactFn = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const { searchHubSpotContact } = await import('@/integrations/hubspot/server/context')

    await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'hubspot'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('HubSpot not connected')
    }

    const accessToken = await getValidAccessToken(integration.id)

    return searchHubSpotContact(accessToken, data.email)
  })
