/**
 * Slack-specific server functions.
 *
 * IMPORTANT: This file is imported by client components (slack-config.tsx, slack-connection-actions.tsx).
 * All server-only dependencies (@slack/web-api, crypto, db, encryption) MUST use dynamic imports
 * inside handlers to avoid bundling Node.js-only code into the client.
 */
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'

/**
 * Slack OAuth state payload.
 */
export interface SlackOAuthState {
  type: 'slack_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

/**
 * Generate a signed OAuth connect URL for Slack.
 * Self-hosted: relative URL to same origin
 */
export const getSlackConnectUrl = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ roles: ['admin'] })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('slack'))) {
      throw new Error(
        'Slack platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host

    const state = signOAuthState({
      type: 'slack_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
    } satisfies SlackOAuthState)

    return `/oauth/slack/connect?state=${encodeURIComponent(state)}`
  }
)

/**
 * Fetch available Slack channels for the connected workspace
 */
export const fetchSlackChannelsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SlackChannel[]> => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('../encryption')
    const { listSlackChannels } = await import('./channels')

    console.log(`[fn:integrations] fetchSlackChannelsFn`)
    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'slack'),
    })

    if (!integration || integration.status !== 'active') {
      throw new Error('Slack not connected')
    }

    if (!integration.secrets) {
      throw new Error('Slack secrets missing')
    }

    const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
    if (!secrets.accessToken) {
      throw new Error('Slack access token missing')
    }

    const channels = await listSlackChannels(secrets.accessToken)

    console.log(`[fn:integrations] fetchSlackChannelsFn: ${channels.length} channels`)
    return channels
  }
)
