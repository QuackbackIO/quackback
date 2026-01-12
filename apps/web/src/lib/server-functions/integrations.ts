import { createServerFn } from '@tanstack/react-start'
import { randomBytes } from 'crypto'
import { requireAuth } from './auth-helpers'
import { signOAuthState } from '@/lib/auth/oauth-state'
import { tenantStorage } from '@/lib/tenant'
import { isMultiTenant } from '@/lib/features'
import type { MemberId } from '@quackback/ids'

/**
 * Slack OAuth state payload.
 */
export interface SlackOAuthState {
  type: 'slack_oauth'
  workspaceId: string
  workspaceSlug: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

/**
 * Generate a signed OAuth connect URL for Slack.
 * Cloud mode: absolute URL to central OAuth domain
 * Self-hosted: relative URL to same origin
 */
export const getSlackConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const auth = await requireAuth({ roles: ['admin'] })
    const tenant = tenantStorage.getStore()
    const isCloud = isMultiTenant() && tenant

    const workspaceSlug = isCloud ? tenant.slug : 'default'
    const returnDomain = isCloud
      ? `${tenant.slug}.${process.env.CLOUD_TENANT_BASE_DOMAIN}`
      : new URL(process.env.ROOT_URL || '').host

    const state = signOAuthState({
      type: 'slack_oauth',
      workspaceId: auth.settings.id,
      workspaceSlug,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies SlackOAuthState)

    const appDomain = process.env.CLOUD_APP_DOMAIN
    const connectPath = `/oauth/slack/connect?state=${encodeURIComponent(state)}`

    if (isCloud && appDomain) {
      return `https://${appDomain}${connectPath}`
    }

    return connectPath
  }
)
