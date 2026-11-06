import { z } from 'zod'
import { channelDestination } from '@/lib/server/integrations/destination'
import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { fetchGitHubStatuses } from '@/integrations/github/server/statuses'
import {
  registerGitHubWebhook,
  deleteGitHubWebhook,
  patchGitHubWebhook,
  findGitHubWebhookByUrl,
} from '@/integrations/github/server/webhook-registration'
import {
  getLiveGitHubConnectionAccount,
  githubWebhookEvents,
  syncGitHubWebhookEvents,
} from '@/lib/server/domains/channel-accounts/github-connection'
import { db, integrations, eq } from '@/lib/server/db'
import { DESTINATION_DIRECTIONS, ensureDestinations } from '@/lib/server/integrations/destinations'
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

export const githubIntegration: IntegrationDefinition = {
  id: 'github',
  destination: {
    ...channelDestination(['organizationName']),
    multiple: {
      kind: 'repo',
      label: 'Repository',
      configSchema: z
        .object({ direction: z.enum(DESTINATION_DIRECTIONS) })
        .partial()
        .strict(),
      // Status sync and the inbox channel both listen to the repository hooks.
      webhookWanted: async (config) =>
        !!config.statusSyncEnabled || !!(await getLiveGitHubConnectionAccount()),
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
      const inboxEnabled = !!(await getLiveGitHubConnectionAccount())
      const events = githubWebhookEvents(inboxEnabled)
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
    if (config.statusSyncEnabled || (await getLiveGitHubConnectionAccount())) {
      // A failure is recorded on the repository and the connection; connecting still succeeds.
      await syncGitHubWebhookEvents().catch(() => {})
    }
  },
  // Every repository's webhook is removed by the framework before this runs
  // (see deleteIntegrationFn), while the token can still authorize it.
  onDisconnect: (secrets, _config, credentials) =>
    revokeGitHubToken(secrets.accessToken as string, credentials),
}
