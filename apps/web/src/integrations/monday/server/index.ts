import { channelDestination } from '@/lib/server/integrations/destination'
import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { mondayHook } from '@/integrations/monday/server/hook'
import { getMondayOAuthUrl, exchangeMondayCode } from '@/integrations/monday/server/oauth'
import { mondayCatalog } from '@/integrations/monday/server/catalog'
import { listMondayBoards } from '@/integrations/monday/server/boards'

export const mondayIntegration: IntegrationDefinition = {
  id: 'monday',
  destination: channelDestination(['workspaceId', 'accountId', 'boardId']),
  catalog: mondayCatalog,
  oauth: {
    stateType: 'monday_oauth',
    buildAuthUrl: getMondayOAuthUrl,
    exchangeCode: exchangeMondayCode,
  },
  destinations: {
    board: {
      label: 'Board',
      list: async ({ accessToken }) => {
        const boards = await listMondayBoards(accessToken)
        return boards.map((b) => ({ id: String(b.id), name: b.name }))
      },
    },
  },
  hook: mondayHook,
  linkedItems: true,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://developer.monday.com/apps/manage',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://developer.monday.com/apps/manage',
    },
  ],
}
