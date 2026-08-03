/**
 * Trello-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { PrincipalId } from '@quackback/ids'

export interface TrelloOAuthState {
  type: 'trello_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
}

export interface TrelloBoard {
  id: string
  name: string
}

export interface TrelloList {
  id: string
  name: string
}

/**
 * Generate a signed OAuth connect URL for Trello.
 */
export const getTrelloConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { getOAuthReturnDomain } = await import('@/lib/server/integrations/oauth')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('trello'))) {
      throw new Error(
        'Trello platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = getOAuthReturnDomain()

    const state = signOAuthState({
      type: 'trello_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies TrelloOAuthState)

    return `/oauth/trello/connect?state=${encodeURIComponent(state)}`
  }
)

/**
 * Fetch available Trello boards for the connected account.
 */
export const fetchTrelloBoardsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TrelloBoard[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listTrelloBoards } = await import('./boards')
    const { logger } = await import('@/lib/server/logger')
    const log = logger.child({ component: 'trello' })

    log.debug('fetch boards')
    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'trello'),
    })

    if (!integration || integration.status !== 'active') {
      throw new Error('Trello not connected')
    }

    if (!integration.secrets) {
      throw new Error('Trello secrets missing')
    }

    const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
    const cfg = (integration.config ?? {}) as { apiKey?: string }

    if (!secrets.accessToken || !cfg.apiKey) {
      throw new Error('Trello credentials missing')
    }

    const boards = await listTrelloBoards(cfg.apiKey, secrets.accessToken)
    log.debug({ board_count: boards.length }, 'fetched boards')
    return boards
  }
)

/**
 * Fetch lists for a specific Trello board.
 */
export const fetchTrelloListsFn = createServerFn({ method: 'POST' })
  .validator(z.object({ boardId: z.string().min(1) }))
  .handler(async ({ data }): Promise<TrelloList[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listTrelloLists } = await import('./boards')
    const { logger } = await import('@/lib/server/logger')
    const log = logger.child({ component: 'trello' })

    log.debug({ board_id: data.boardId }, 'fetch lists')
    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'trello'),
    })

    if (!integration || integration.status !== 'active') {
      throw new Error('Trello not connected')
    }

    const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets!)
    const cfg = (integration.config ?? {}) as { apiKey?: string }

    if (!secrets.accessToken || !cfg.apiKey) {
      throw new Error('Trello credentials missing')
    }

    const lists = await listTrelloLists(cfg.apiKey, secrets.accessToken, data.boardId)
    log.debug({ list_count: lists.length }, 'fetched lists')
    return lists
  })
