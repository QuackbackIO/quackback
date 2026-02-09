import type { IntegrationDefinition } from '../types'
import { notionHook } from './hook'
import { getNotionOAuthUrl, exchangeNotionCode } from './oauth'
import { notionCatalog } from './catalog'

export const notionIntegration: IntegrationDefinition = {
  id: 'notion',
  catalog: notionCatalog,
  oauth: {
    stateType: 'notion_oauth',
    buildAuthUrl: getNotionOAuthUrl,
    exchangeCode: exchangeNotionCode,
  },
  hook: notionHook,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'OAuth Client ID',
      sensitive: false,
      helpUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
    },
    {
      key: 'clientSecret',
      label: 'OAuth Client Secret',
      sensitive: true,
      helpUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
    },
  ],
}
