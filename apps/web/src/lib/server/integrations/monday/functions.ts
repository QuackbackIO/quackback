/**
 * Monday.com-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { MemberId } from '@quackback/ids'

export interface MondayOAuthState {
  type: 'monday_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
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
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('monday'))) {
      throw new Error(
        'Monday.com platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'monday_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
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

    console.log(`[fn:integrations] fetchMondayBoardsFn`)
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
    console.log(`[fn:integrations] fetchMondayBoardsFn: ${boards.length} boards`)
    return boards
  }
)
