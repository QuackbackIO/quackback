/**
 * Notion-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { MemberId } from '@quackback/ids'

export interface NotionOAuthState {
  type: 'notion_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
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
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
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
      memberId: auth.member.id,
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
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listNotionDatabases } = await import('./databases')

    console.log(`[fn:integrations] fetchNotionDatabasesFn`)
    await requireAuth({ roles: ['admin'] })

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

    console.log(`[fn:integrations] fetchNotionDatabasesFn: ${databases.length} databases`)
    return databases
  }
)
