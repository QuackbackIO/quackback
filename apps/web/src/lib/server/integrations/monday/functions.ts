/**
 * Monday.com-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'

export interface MondayOAuthState {
  type: 'monday_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
}

export interface MondayBoard {
  id: string
  name: string
}

/**
 * Generate a signed OAuth connect URL for Monday.com.
 */
export const getMondayConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { getOAuthReturnDomain } = await import('@/lib/server/integrations/oauth')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('monday'))) {
      throw new Error(
        'Monday.com platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = getOAuthReturnDomain()

    const state = signOAuthState({
      type: 'monday_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies MondayOAuthState)

    return `/oauth/monday/connect?state=${encodeURIComponent(state)}`
  }
)

/**
 * Fetch available Monday.com boards.
 */
export const fetchMondayBoardsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MondayBoard[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listMondayBoards } = await import('./boards')
    const { logger } = await import('@/lib/server/logger')
    const log = logger.child({ component: 'monday' })

    log.debug('fetch monday boards')
    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'monday'),
    })

    if (!integration || integration.status !== 'active') {
      throw new Error('Monday.com not connected')
    }

    if (!integration.secrets) {
      throw new Error('Monday.com secrets missing')
    }

    const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
    if (!secrets.accessToken) {
      throw new Error('Monday.com access token missing')
    }

    const boards = await listMondayBoards(secrets.accessToken)
    log.debug({ board_count: boards.length }, 'fetched monday boards')
    return boards
  }
)
