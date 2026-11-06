/**
 * GitHub-specific server functions.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { IntegrationDestinationId, PrincipalId } from '@quackback/ids'
import type {
  GitHubInboundMode,
  GitHubTicketScope,
} from '@/lib/server/domains/channel-accounts/github-connection'
import type { GitHubAccount, GitHubPersonSuggestion } from '@/integrations/github/server/people'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ValidationError } from '@/lib/shared/errors'

export type { GitHubAccount, GitHubPersonSuggestion }

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
      throw new ValidationError(
        'PLATFORM_CREDENTIALS_NOT_CONFIGURED',
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

/** One repository as the inbox channel page shows it. */
export interface GitHubChannelRepository {
  id: string
  repo: string
  /** Switched on for sync at all (the integration's own switch). */
  enabled: boolean
  /** Whether its issues and comments come into the inbox, and whether each opens a ticket. */
  inboundMode: GitHubInboundMode
  /** The team and ticket type its tickets get, in `tickets` mode. */
  ticketScope: GitHubTicketScope
  /** False for a send-only repository, whose deliveries are never read. */
  receives: boolean
  /** The events its webhook was last registered for. */
  webhookEvents: string[]
  lastInboundAt: string | null
}

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
  repositories: GitHubChannelRepository[]
}

export const getGitHubChannelStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GitHubChannelStatus> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const {
      getLiveGitHubConnectionAccount,
      githubAccessTokenPresent,
      githubInboundMode,
      githubTicketScope,
    } = await import('@/lib/server/domains/channel-accounts/github-connection')
    const { listDestinations, destinationReceives } =
      await import('@/lib/server/integrations/destinations')

    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })
    const config = (integration?.config ?? {}) as Record<string, unknown>
    const inbox = await getLiveGitHubConnectionAccount()
    let hasToken = false
    if (integration?.secrets) {
      try {
        const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
        hasToken = githubAccessTokenPresent({
          accessToken: await getValidAccessToken(integration.id),
        })
      } catch {
        hasToken = false
      }
    }
    const missingTokenError =
      !!inbox && !hasToken ? 'GitHub is not connected. Connect GitHub to send comments.' : null
    const repositories = integration ? await listDestinations(integration.id, 'repo') : []
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
      repositories: repositories.map((repository) => ({
        id: repository.id,
        repo: repository.externalId,
        enabled: repository.enabled,
        inboundMode: githubInboundMode(repository.config),
        ticketScope: githubTicketScope(repository.config),
        receives: destinationReceives({ ...repository, enabled: true }),
        webhookEvents: repository.webhookEvents ?? [],
        lastInboundAt: repository.lastInboundAt?.toISOString() ?? null,
      })),
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
      optInDefaultGitHubRepository,
    } = await import('@/lib/server/domains/channel-accounts/github-connection')

    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })
    if (data.enabled) {
      let accessToken: string | undefined
      if (integration?.secrets) {
        const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
        try {
          accessToken = await getValidAccessToken(integration.id)
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
      const { ensureDestinations } = await import('@/lib/server/integrations/destinations')
      await ensureDestinations(integration)
      await optInDefaultGitHubRepository(integration)
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

/**
 * What one repository does with its issues: nothing, inbox conversations, or
 * conversations each paired with a ticket (with the team and ticket type
 * those tickets get). A channel setting (`channel_account.manage`), like the
 * inbox switch itself; only that repository's webhook is resubscribed.
 */
export const setGitHubRepositoryInboxFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      destinationId: z.string().max(100),
      inboundMode: z.enum(['off', 'conversations', 'tickets']),
      ticketScope: z
        .object({
          teamId: z.string().max(100).nullable(),
          ticketTypeId: z.string().max(100).nullable(),
        })
        .optional(),
    })
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, eq, integrationDestinations, integrations } = await import('@/lib/server/db')
    const { NotFoundError } = await import('@/lib/shared/errors')

    await requireAuth({ permission: PERMISSIONS.CHANNEL_ACCOUNT_MANAGE })
    const [row] = await db
      .select({ integrationType: integrations.integrationType })
      .from(integrationDestinations)
      .innerJoin(integrations, eq(integrations.id, integrationDestinations.integrationId))
      .where(eq(integrationDestinations.id, data.destinationId as IntegrationDestinationId))
      .limit(1)
    if (row?.integrationType !== 'github')
      throw new NotFoundError('DESTINATION_NOT_FOUND', 'Repository not found')
    const { updateDestinationConfig } = await import('@/lib/server/integrations/destination-admin')
    await updateDestinationConfig(data.destinationId, {
      inboundMode: data.inboundMode,
      ...(data.ticketScope ? { ticketScope: data.ticketScope } : {}),
    })
    return { ok: true }
  })

export const fetchGitHubReposFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GitHubRepo[]> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { getValidAccessToken } = await import('@/lib/server/integrations/token-refresh')
    const { listGitHubRepos } = await import('@/integrations/github/server/repos')

    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })

    if (!integration?.secrets || integration.status !== 'active') {
      throw new Error('GitHub not connected')
    }

    const secrets = { accessToken: await getValidAccessToken(integration.id) }
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

/**
 * Suggest teammates for the GitHub accounts that can be assigned issues in
 * the synced repositories (switched on ones only) and are not matched yet.
 * Nothing is stored: each suggestion is matched only when someone accepts it.
 */
export const suggestGitHubPeopleFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ scanned: number; suggestions: GitHubPersonSuggestion[] }> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })
    if (!integration?.secrets || integration.status !== 'active')
      throw new ValidationError('INTEGRATION_UNAVAILABLE', 'Connect GitHub first')

    const { listDestinations } = await import('@/lib/server/integrations/destinations')
    const { listUserMappings } = await import('@/lib/server/integrations/user-mappings')
    const { listAssignableTeammates } = await import('@/lib/server/domains/teams/team.service')
    const { withIntegrationReadAuth } = await import('@/lib/server/integrations/token-refresh')
    const { suggestGitHubPeople } = await import('@/integrations/github/server/people')
    const repositories = (await listDestinations(integration.id, 'repo'))
      .filter((r) => r.enabled)
      .map((r) => r.externalId)
    const mappings = await listUserMappings(integration.id)
    const teammates = await listAssignableTeammates()
    return withIntegrationReadAuth(integration.id, ({ accessToken }) =>
      suggestGitHubPeople({
        accessToken,
        repositories,
        teammates,
        mappedAccountIds: new Set(mappings.map((m) => m.externalUserId)),
        mappedPrincipalIds: new Set(mappings.map((m) => m.principalId as string)),
      })
    )
  }
)

/**
 * Look a GitHub account up by login, so a teammate can be matched to an
 * account nobody suggested. The match is stored by GitHub's numeric id.
 */
export const findGitHubUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ login: z.string().trim().min(1).max(39) }))
  .handler(async ({ data }): Promise<GitHubAccount> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { db, integrations, eq } = await import('@/lib/server/db')
    const { NotFoundError } = await import('@/lib/shared/errors')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'github'),
    })
    if (!integration?.secrets || integration.status !== 'active')
      throw new ValidationError('INTEGRATION_UNAVAILABLE', 'Connect GitHub first')
    const login = data.login.replace(/^@/, '')
    const { withIntegrationReadAuth } = await import('@/lib/server/integrations/token-refresh')
    const { getGitHubUser } = await import('@/integrations/github/server/people')
    const found = await withIntegrationReadAuth(integration.id, ({ accessToken }) =>
      getGitHubUser(accessToken, login)
    )
    if (!found) throw new NotFoundError('GITHUB_USER_NOT_FOUND', `GitHub has no user @${login}`)
    return { id: found.id, login: found.login, name: found.name, avatarUrl: found.avatarUrl }
  })
