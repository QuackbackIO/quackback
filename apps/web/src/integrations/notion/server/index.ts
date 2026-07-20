import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { archiveNotionPage } from '@/integrations/notion/server/archive'
import { notionHook } from '@/integrations/notion/server/hook'
import { getNotionOAuthUrl, exchangeNotionCode } from '@/integrations/notion/server/oauth'
import { notionCatalog } from '@/integrations/notion/server/catalog'
import { listNotionDatabases } from '@/integrations/notion/server/databases'

export const notionIntegration: IntegrationDefinition = {
  id: 'notion',
  catalog: notionCatalog,
  oauth: {
    stateType: 'notion_oauth',
    buildAuthUrl: getNotionOAuthUrl,
    exchangeCode: exchangeNotionCode,
  },
  destinations: {
    database: {
      label: 'Database',
      list: async ({ accessToken }) => {
        const databases = await listNotionDatabases(accessToken)
        return databases.map((d) => ({ id: d.id, name: d.name }))
      },
    },
  },
  hook: notionHook,
  archive: archiveNotionPage,
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
