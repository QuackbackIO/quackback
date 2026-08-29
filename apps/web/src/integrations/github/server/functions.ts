/**
 * GitHub-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface GitHubOAuthState {
  type: 'github_oauth'
  workspaceId: string
  returnDomain: string
  principalId: PrincipalId
  nonce: string
  ts: number
  returnPath?: string
}

const CHANNEL_GITHUB_PATH = '/admin/settings/channels/github'

export interface GitHubRepo {
  id: number
  fullName: string
  private: boolean
}

export const getGitHubConnectUrl = createServerFn({ method: 'GET' })
  .validator(z.object({ returnPath: z.string().optional() }).optional())
  .handler(async ({ data }): Promise<string> => {
    const { randomBytes } = await import('crypto')
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { signOAuthState } = await import('@/lib/server/auth/oauth-state')
    const { config } = await import('@/lib/server/config')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const { hasPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    if (!(await hasPlatformCredentials('github'))) {
      throw new Error(
        'GitHub platform credentials not configured. Configure them in integration settings first.'
      )
    }
    const returnDomain = new URL(config.baseUrl).host
    const returnPath = data?.returnPath === CHANNEL_GITHUB_PATH ? CHANNEL_GITHUB_PATH : undefined

    const state = signOAuthState({
      type: 'github_oauth',
      workspaceId: auth.settings.id,
      returnDomain,
      principalId: auth.principal.id,
      nonce: randomBytes(16).toString('base64url'),
      ts: Date.now(),
      ...(returnPath ? { returnPath } : {}),
    } satisfies GitHubOAuthState)

    return `/oauth/github/connect?state=${encodeURIComponent(state)}`
  })

export interface GitHubChannelStatus {
  connected: boolean
  status: 'active' | 'paused' | 'pending' | null
  inboxEnabled: boolean
  /** True when an access token is stored. Never the token itself. */
  hasToken: boolean
  repo: string | null
  username: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastOutboundAt: string | null
  lastInboundAt: string | null
}

export const getGitHubChannelStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GitHubChannelStatus> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { getLiveGitHubConnectionAccount, githubAccessTokenPresent } =
      await import('@/lib/server/domains/channel-accounts/github-connection')

    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })
    const config = (integration?.config ?? {}) as Record<string, unknown>
    const inbox = await getLiveGitHubConnectionAccount()
    let hasToken = false
    if (integration?.secrets) {
      try {
        const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
        hasToken = githubAccessTokenPresent(
          decryptSecrets<{ accessToken?: string }>(integration.secrets)
        )
      } catch {
        hasToken = false
      }
    }
    const missingTokenError =
      !!inbox && !hasToken ? 'GitHub is not connected. Connect GitHub to send comments.' : null
    return {
      connected: integration?.status === 'active' || integration?.status === 'paused',
      status: (integration?.status as GitHubChannelStatus['status']) ?? null,
      inboxEnabled: !!inbox,
      hasToken,
      repo: typeof config.channelId === 'string' ? config.channelId : null,
      username: typeof config.username === 'string' ? config.username : null,
      lastError: integration?.lastError ?? missingTokenError,
      lastErrorAt: integration?.lastErrorAt?.toISOString() ?? null,
      lastOutboundAt: integration?.lastOutboundAt?.toISOString() ?? null,
      lastInboundAt: integration?.lastInboundAt?.toISOString() ?? null,
    }
  }
)

export const setGitHubInboxEnabledFn = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const {
      ensureGitHubConnectionAccount,
      disableGitHubConnectionAccount,
      syncGitHubWebhookEvents,
      githubInboxEnableDeniedReason,
    } = await import('@/lib/server/domains/channel-accounts/github-connection')

    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })
    if (data.enabled) {
      let accessToken: string | undefined
      if (integration?.secrets) {
        const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
        try {
          accessToken = decryptSecrets<{ accessToken?: string }>(integration.secrets).accessToken
        } catch {
          accessToken = undefined
        }
      }
      const denied = githubInboxEnableDeniedReason({
        status: integration?.status,
        accessToken,
      })
      if (denied || !integration) {
        throw new Error(denied ?? 'Connect GitHub before enabling the inbox channel.')
      }
      await ensureGitHubConnectionAccount(integration.id)
    } else {
      await disableGitHubConnectionAccount()
    }
    try {
      await syncGitHubWebhookEvents()
    } catch {
      // lastError is already recorded; the switch still persists.
    }
    return { ok: true }
  })

export const fetchGitHubReposFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GitHubRepo[]> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
    const { listGitHubRepos } = await import('@/integrations/github/server/repos')

    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('GitHub not connected')
    }

    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    return listGitHubRepos(secrets.accessToken)
  }
)

export const retryGitHubAgentMessageFn = createServerFn({ method: 'POST' })
  .validator(z.object({ messageId: z.string() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireAuth, policyActorFromAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, eq, conversationMessages, conversations } = await import('@/lib/server/db')
    const { retryGitHubAgentMessage } = await import('@/lib/server/domains/channels/github-deliver')
    const { canActAsAgent } = await import('@/lib/server/policy/conversation')
    const { ForbiddenError, NotFoundError } = await import('@/lib/shared/errors')
    const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
    const actor = await policyActorFromAuth(ctx)
    if (!canActAsAgent(actor).allowed) throw new ForbiddenError('FORBIDDEN', 'Agent required')

    const [message] = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.id, data.messageId as never))
      .limit(1)
    if (!message?.conversationId || message.isInternal || message.senderType !== 'agent') {
      throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    }
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, message.conversationId))
      .limit(1)
    if (!conversation || conversation.channel !== 'github') {
      throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
    }
    await retryGitHubAgentMessage({
      conversationId: conversation.id,
      messageId: message.id,
      visitorPrincipalId: conversation.visitorPrincipalId,
      content: message.content,
      contentJson: message.contentJson,
      agentName: ctx.user.name || 'Support',
      recipient: '',
      ctaUrl: '',
      workspaceName: '',
      logoUrl: null,
      direction: 'agent_reply',
    })
    return { ok: true }
  })
