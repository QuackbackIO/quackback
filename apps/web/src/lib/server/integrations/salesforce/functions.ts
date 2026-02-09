/**
 * Salesforce-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import type { MemberId } from '@quackback/ids'

export interface SalesforceOAuthState {
  type: 'salesforce_oauth'
  workspaceId: string
  returnDomain: string
  memberId: MemberId
  nonce: string
  ts: number
}

/**
 * Generate a signed OAuth connect URL for Salesforce.
 */
export const getSalesforceConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('salesforce'))) {
      throw new Error(
        'Salesforce platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'salesforce_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      memberId: auth.member.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies SalesforceOAuthState)

    return `/oauth/salesforce/connect?state=${encodeURIComponent(state)}`
  }
)
