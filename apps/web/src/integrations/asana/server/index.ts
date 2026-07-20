import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { completeAsanaTask } from '@/integrations/asana/server/archive'
import { fetchAsanaSections } from '@/integrations/asana/server/statuses'
import {
  registerAsanaWebhook,
  deleteAsanaWebhook,
} from '@/integrations/asana/server/webhook-registration'
import { asanaHook } from '@/integrations/asana/server/hook'
import { asanaInboundHandler } from '@/integrations/asana/server/inbound'
import {
  getAsanaOAuthUrl,
  exchangeAsanaCode,
  revokeAsanaToken,
  refreshAsanaToken,
} from '@/integrations/asana/server/oauth'
import { asanaCatalog } from '@/integrations/asana/server/catalog'
import { listAsanaProjects } from '@/integrations/asana/server/projects'

export const asanaIntegration: IntegrationDefinition = {
  id: 'asana',
  catalog: asanaCatalog,
  oauth: {
    stateType: 'asana_oauth',
    buildAuthUrl: getAsanaOAuthUrl,
    exchangeCode: exchangeAsanaCode,
  },
  destinations: {
    project: {
      label: 'Project',
      list: async ({ accessToken, config }) => {
        const workspaceGid = config.workspaceId as string | undefined
        if (!workspaceGid) throw new Error('No Asana workspace configured')
        const projects = await listAsanaProjects(accessToken, workspaceGid)
        return projects.map((p) => ({ id: p.id, name: p.name }))
      },
    },
  },
  hook: asanaHook,
  inbound: asanaInboundHandler,
  archive: completeAsanaTask,
  webhookRegistration: {
    register: async ({ accessToken, config, callbackUrl }) => {
      const projectGid = config.channelId as string
      if (!projectGid) throw new Error('No Asana project configured')
      const result = await registerAsanaWebhook(accessToken, projectGid, callbackUrl)
      return { externalWebhookId: result.webhookId }
    },
    unregister: async ({ accessToken, externalWebhookId }) =>
      deleteAsanaWebhook(accessToken, externalWebhookId),
  },
  listExternalStatuses: fetchAsanaSections,
  refreshToken: refreshAsanaToken,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://developers.asana.com/docs/oauth',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://developers.asana.com/docs/oauth',
    },
  ],
  onDisconnect: (secrets, _config, credentials) =>
    revokeAsanaToken(secrets.refreshToken as string, credentials),
}
