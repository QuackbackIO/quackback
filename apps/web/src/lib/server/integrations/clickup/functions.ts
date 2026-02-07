/**
 * ClickUp-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MemberId } from '@quackback/ids'

export interface ClickUpOAuthState {
  type: 'clickup_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

export interface ClickUpSpace {
  id: string
  name: string
}

export interface ClickUpList {
  id: string
  name: string
}

interface ClickUpIntegrationConfig {
  teamId?: string
  workspaceName?: string
}

export const getClickUpConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'clickup_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies ClickUpOAuthState)

    return `/oauth/clickup/connect?state=${encodeURIComponent(state)}`
  }
)

export const fetchClickUpSpacesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ClickUpSpace[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listClickUpSpaces } = await import('./lists')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'clickup'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('ClickUp not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    const cfg = (integration.config ?? {}) as ClickUpIntegrationConfig
    if (!cfg.teamId) {
      throw new Error('ClickUp team ID not found. Please reconnect ClickUp.')
    }
    return listClickUpSpaces(secrets.accessToken, cfg.teamId)
  }
)

export const fetchClickUpListsFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ spaceId: z.string().min(1) }))
  .handler(async ({ data: { spaceId } }): Promise<ClickUpList[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listClickUpLists } = await import('./lists')

    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'clickup'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('ClickUp not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    return listClickUpLists(secrets.accessToken, spaceId)
  })
