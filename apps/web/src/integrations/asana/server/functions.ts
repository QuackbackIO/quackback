/**
 * Asana-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface AsanaOAuthState {
  type: 'asana_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
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
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
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
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies AsanaOAuthState)

    return `/oauth/asana/connect?state=${encodeURIComponent(state)}`
  }
)

export const fetchAsanaProjectsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AsanaProject[]> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { getIntegrationAuth } = await import('@/lib/server/integrations/token-refresh')
    const { listAsanaProjects } = await import('@/integrations/asana/server/projects')

    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'asana'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Asana not connected')
    }

    const { accessToken, config: currentConfig } = await getIntegrationAuth(integration.id)
    const cfg = currentConfig as AsanaIntegrationConfig
    return listAsanaProjects(accessToken, cfg.workspaceId as string)
  }
)
