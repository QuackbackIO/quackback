import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { salesforceContext } from '@/integrations/salesforce/server/enrichment'
import {
  getSalesforceOAuthUrl,
  exchangeSalesforceCode,
  refreshSalesforceToken,
} from '@/integrations/salesforce/server/oauth'
import { salesforceCatalog } from '@/integrations/salesforce/server/catalog'

export const salesforceIntegration: IntegrationDefinition = {
  id: 'salesforce',
  catalog: salesforceCatalog,
  oauth: {
    stateType: 'salesforce_oauth',
    buildAuthUrl: getSalesforceOAuthUrl,
    exchangeCode: exchangeSalesforceCode,
  },
  context: salesforceContext,
  refreshToken: refreshSalesforceToken,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Consumer Key',
      sensitive: false,
      helpUrl: 'https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm',
    },
    {
      key: 'clientSecret',
      label: 'Consumer Secret',
      sensitive: true,
      helpUrl: 'https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm',
    },
  ],
}
