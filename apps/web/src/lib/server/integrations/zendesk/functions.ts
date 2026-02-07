/**
 * Zendesk-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MemberId } from '@quackback/ids'

export interface ZendeskOAuthState {
  type: 'zendesk_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
  preAuthFields: { subdomain: string }
}

interface ZendeskIntegrationConfig {
  subdomain?: string
  workspaceName?: string
}

export const getZendeskConnectUrl = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      subdomain: z
        .string()
        .min(1)
        .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Invalid subdomain format'),
    })
  )
  .handler(async ({ data }): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'zendesk_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
      preAuthFields: { subdomain: data.subdomain },
    } satisfies ZendeskOAuthState)

    return `/oauth/zendesk/connect?state=${encodeURIComponent(state)}`
  })

export const searchZendeskUserFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { searchZendeskUser } = await import('./context')

    await requireAuth({ roles: ['admin', 'member'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'zendesk'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('Zendesk not connected')
    }

    const cfg = (integration.config ?? {}) as ZendeskIntegrationConfig
    const subdomain = cfg.subdomain
    if (!subdomain) {
      throw new Error('Zendesk subdomain not configured')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    return searchZendeskUser(secrets.accessToken, subdomain, data.email)
  })
