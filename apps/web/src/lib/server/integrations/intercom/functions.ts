/**
 * Intercom-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MemberId } from '@quackback/ids'

export interface IntercomOAuthState {
  type: 'intercom_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

export const getIntercomConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'intercom_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies IntercomOAuthState)

    return `/oauth/intercom/connect?state=${encodeURIComponent(state)}`
  }
)

export const searchIntercomContactFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { searchContact } = await import('./context')

    await requireAuth({ roles: ['admin', 'member'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'intercom'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Intercom not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    return searchContact(secrets.accessToken, data.email)
  })
