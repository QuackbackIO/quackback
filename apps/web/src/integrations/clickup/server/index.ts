import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { closeClickUpTask } from '@/integrations/clickup/server/archive'
import { fetchClickUpStatuses } from '@/integrations/clickup/server/statuses'
import {
  registerClickUpWebhook,
  deleteClickUpWebhook,
} from '@/integrations/clickup/server/webhook-registration'
import { clickupHook } from '@/integrations/clickup/server/hook'
import { clickupInboundHandler } from '@/integrations/clickup/server/inbound'
import { listClickUpSpaces, listClickUpLists } from '@/integrations/clickup/server/lists'
import { getClickUpOAuthUrl, exchangeClickUpCode } from '@/integrations/clickup/server/oauth'
import { clickupCatalog } from '@/integrations/clickup/server/catalog'
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
  destinations: {
    space: {
      label: 'Space',
      list: async ({ accessToken, config }) => {
        const teamId = config.teamId as string
        return listClickUpSpaces(accessToken, teamId)
      },
    },
    list: {
      label: 'List',
      childOf: 'space',
      list: async ({ accessToken, parentId }) => {
        if (!parentId) return []
        return listClickUpLists(accessToken, parentId)
      },
    },
  },
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
