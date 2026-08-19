/**
 * Notion-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface NotionOAuthState {
  type: 'notion_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
}

export interface NotionDatabase {
  id: string
  name: string
}

/**
 * Generate a signed OAuth connect URL for Notion.
 */
export const getNotionConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('notion'))) {
      throw new Error(
        'Notion platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'notion_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies NotionOAuthState)

    return `/oauth/notion/connect?state=${encodeURIComponent(state)}`
  }
)

/**
 * Fetch available Notion databases for the connected workspace.
 */
export const fetchNotionDatabasesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NotionDatabase[]> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
    const { listNotionDatabases } = await import('@/integrations/notion/server/databases')
    const { logger } = await import('@/lib/server/logger')
    const log = logger.child({ component: 'notion' })

    log.debug('fetch notion databases')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'notion'),
    })

    if (!integration || integration.status !== 'active') {
      throw new Error('Notion not connected')
    }

    if (!integration.secrets) {
      throw new Error('Notion secrets missing')
    }

    const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
    if (!secrets.accessToken) {
      throw new Error('Notion access token missing')
    }

    const databases = await listNotionDatabases(secrets.accessToken)

    log.debug({ database_count: databases.length }, 'fetched notion databases')
    return databases
  }
)
