import type { IntegrationDefinition } from '../types'
import { completeAsanaTask } from './archive'
import { fetchAsanaSections } from './statuses'
import { registerAsanaWebhook, deleteAsanaWebhook } from './webhook-registration'
import { asanaHook } from './hook'
import { asanaInboundHandler } from './inbound'
import { getAsanaOAuthUrl, exchangeAsanaCode, revokeAsanaToken } from './oauth'
import { asanaCatalog } from './catalog'

export const asanaIntegration: IntegrationDefinition = {
  id: 'asana',
  catalog: asanaCatalog,
  oauth: {
    stateType: 'asana_oauth',
    buildAuthUrl: getAsanaOAuthUrl,
    exchangeCode: exchangeAsanaCode,
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
