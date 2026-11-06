import { z } from 'zod'
import {
  ISSUE_LABEL_MAX,
  ISSUE_PUSH_STATES,
  ISSUE_STATE_REASONS,
  PRIORITY_LABEL_PREFIX,
} from '@/lib/shared/issue-push'
import { channelDestination } from '@/lib/server/integrations/destination'
import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { fetchGitHubStatuses, GITHUB_ISSUE_STATES } from '@/integrations/github/server/statuses'
import {
  registerGitHubWebhook,
  deleteGitHubWebhook,
  patchGitHubWebhook,
  findGitHubWebhookByUrl,
} from '@/integrations/github/server/webhook-registration'
import {
  GITHUB_INBOUND_MODES,
  getLiveGitHubConnectionAccount,
  githubBringsIssuesIn,
  githubHookWanted,
  githubWebhookEvents,
  syncGitHubWebhookEvents,
} from '@/lib/server/domains/channel-accounts/github-connection'
import { db, integrations, eq } from '@/lib/server/db'
import {
  DESTINATION_COMMENT_VISIBILITIES,
  DESTINATION_DIRECTIONS,
  destinationCommentVisibility,
  ensureDestinations,
  listDestinations,
} from '@/lib/server/integrations/destinations'
import { githubHook } from '@/integrations/github/server/hook'
import { githubInboundHandler } from '@/integrations/github/server/inbound'
import { githubIssues } from '@/integrations/github/server/issues'
import {
  getGitHubOAuthUrl,
  exchangeGitHubCode,
  revokeGitHubToken,
} from '@/integrations/github/server/oauth'
import { githubCatalog } from '@/integrations/github/server/catalog'
import { listGitHubRepos } from '@/integrations/github/server/repos'

/**
 * One ticket status's issue: open, or closed with a reason, and an optional
 * label. A status label may not look like a priority label, which Quackback
 * also owns.
 */
const issuePushStateSchema = z
  .object({
    state: z.enum(ISSUE_PUSH_STATES),
    stateReason: z.enum(ISSUE_STATE_REASONS).optional(),
    label: z
      .string()
      .trim()
      .min(1)
      .max(ISSUE_LABEL_MAX)
      .refine((label) => !label.toLowerCase().startsWith(PRIORITY_LABEL_PREFIX))
      .optional(),
  })
  .strict()
  .refine((value) => value.state === 'closed' || value.stateReason === undefined)

export const githubIntegration: IntegrationDefinition = {
  id: 'github',
  destination: {
    ...channelDestination(['organizationName']),
    multiple: {
      kind: 'repo',
      label: 'Repository',
      configSchema: z
        .object({
          direction: z.enum(DESTINATION_DIRECTIONS),
          inboundMode: z.enum(GITHUB_INBOUND_MODES),
          ticketScope: z
            .object({
              teamId: z.string().max(100).nullable(),
              ticketTypeId: z.string().max(100).nullable(),
            })
            .partial()
            .strict(),
          ticketStatusMappings: z.partialRecord(
            z.enum(GITHUB_ISSUE_STATES),
            z.string().max(100).nullable()
          ),
          assigneeSync: z.boolean(),
          postRepliesAsComments: z.boolean(),
          commentVisibility: z.enum(DESTINATION_COMMENT_VISIBILITIES),
          applyAutomatically: z.boolean(),
          pushStatusMappings: z.record(z.string().max(100), issuePushStateSchema.nullable()),
        })
        .partial()
        .strict(),
      // The ticket scope and status mappings must name a live team, a
      // customer ticket type and live statuses.
      validateConfig: async (patch) => {
        const { validateGitHubRepositorySettings } =
          await import('@/lib/server/domains/conversation/conversation.github-tickets')
        await validateGitHubRepositorySettings(patch)
      },
      // Status sync listens to every repository's hook; the inbox, assignee
      // sync and comments into tickets only to the hooks of repositories
      // that use them.
      webhookWanted: async (config) =>
        githubHookWanted(config, {
          statusSync: !!config.statusSyncEnabled,
          inboxLive: !!(await getLiveGitHubConnectionAccount()),
        }),
      // While the inbox is on, the first repository to arrive brings its
      // issues in, as the single repository always did; later ones start off.
      initialConfig: async (integrationId) => {
        if (!(await getLiveGitHubConnectionAccount())) return { inboundMode: 'off' }
        const repositories = await listDestinations(integrationId, 'repo')
        return {
          inboundMode: repositories.some((r) => githubBringsIssuesIn(r.config))
            ? 'off'
            : 'conversations',
        }
      },
      // A changed inbox or comment choice changes which events that
      // repository's hook needs, and switching assignee sync on may need a
      // hook at all.
      onConfigChanged: (destination) => syncGitHubWebhookEvents(destination.id).catch(() => {}),
    },
  },
  catalog: githubCatalog,
  oauth: {
    stateType: 'github_oauth',
    buildAuthUrl: getGitHubOAuthUrl,
    exchangeCode: exchangeGitHubCode,
  },
  destinations: {
    repo: {
      label: 'Repository',
      list: async ({ accessToken }) => {
        const repos = await listGitHubRepos(accessToken)
        return repos.map((r) => ({ id: r.fullName, name: r.fullName, key: String(r.id) }))
      },
    },
  },
  hook: githubHook,
  inbound: githubInboundHandler,
  issues: githubIssues,
  linkedItems: true,
  webhookRegistration: {
    register: async ({ accessToken, config, callbackUrl, secret }) => {
      const ownerRepo = config.channelId as string
      if (!ownerRepo) throw new Error('No repository configured')
      const events = githubWebhookEvents(config, {
        inboxLive: !!(await getLiveGitHubConnectionAccount()),
      })
      try {
        const result = await registerGitHubWebhook(
          accessToken,
          ownerRepo,
          callbackUrl,
          secret,
          events
        )
        return { externalWebhookId: result.webhookId, events }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        if (!/already exists/i.test(raw)) throw err
        const existingId = await findGitHubWebhookByUrl(accessToken, ownerRepo, callbackUrl)
        if (!existingId) throw err
        await patchGitHubWebhook(accessToken, ownerRepo, existingId, events, callbackUrl, secret)
        return { externalWebhookId: existingId, events }
      }
    },
    unregister: async ({ accessToken, config, externalWebhookId }) => {
      const ownerRepo = config.channelId as string
      if (ownerRepo) await deleteGitHubWebhook(accessToken, ownerRepo, externalWebhookId)
    },
  },
  listExternalStatuses: fetchGitHubStatuses,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://github.com/settings/developers',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://github.com/settings/developers',
    },
  ],
  // A connection saved before repositories had their own rows gets its
  // repository row now, with the legacy webhook secret moved onto it
  // encrypted. A reconnect may change whose token patches the hooks, so the
  // hooks are brought back in line when anything listens to them.
  onConnect: async (integrationId) => {
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId),
    })
    if (!integration) return
    await ensureDestinations(integration)
    const config = (integration.config ?? {}) as Record<string, unknown>
    const repositories = await listDestinations(integration.id, 'repo')
    if (
      config.statusSyncEnabled ||
      (await getLiveGitHubConnectionAccount()) ||
      repositories.some((r) => r.config.assigneeSync || destinationCommentVisibility(r) !== 'off')
    ) {
      // A failure is recorded on the repository and the connection; connecting still succeeds.
      await syncGitHubWebhookEvents().catch(() => {})
    }
  },
  // Every repository's webhook is removed by the framework before this runs
  // (see deleteIntegrationFn), while the token can still authorize it.
  onDisconnect: (secrets, _config, credentials) =>
    revokeGitHubToken(secrets.accessToken as string, credentials),
}
