import type { IntegrationDefinition } from '../types'
import { closeClickUpTask } from './archive'
import { fetchClickUpStatuses } from './statuses'
import { registerClickUpWebhook, deleteClickUpWebhook } from './webhook-registration'
import { clickupHook } from './hook'
import { clickupInboundHandler } from './inbound'
import { getClickUpOAuthUrl, exchangeClickUpCode } from './oauth'
import { clickupCatalog } from './catalog'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'clickup' })

export const clickupIntegration: IntegrationDefinition = {
  id: 'clickup',
  catalog: clickupCatalog,
  oauth: {
    stateType: 'clickup_oauth',
    buildAuthUrl: getClickUpOAuthUrl,
    exchangeCode: exchangeClickUpCode,
  },
  hook: clickupHook,
  inbound: clickupInboundHandler,
  archive: closeClickUpTask,
  webhookRegistration: {
    register: async ({ accessToken, config, callbackUrl, secret }) => {
      const teamId = config.teamId as string
      if (!teamId) throw new Error('No ClickUp team configured')
      const result = await registerClickUpWebhook(accessToken, teamId, callbackUrl, secret)
      return { externalWebhookId: result.webhookId }
    },
    unregister: async ({ accessToken, externalWebhookId }) =>
      deleteClickUpWebhook(accessToken, externalWebhookId),
  },
  listExternalStatuses: fetchClickUpStatuses,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://clickup.com/integrations',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://clickup.com/integrations',
    },
  ],
  async onDisconnect() {
    log.info('integration disconnected, no token revocation available')
  },
}
