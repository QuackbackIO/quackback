import type { IntegrationDefinition } from '../types'
import { salesforceHook } from './hook'
import { getSalesforceOAuthUrl, exchangeSalesforceCode } from './oauth'
import { salesforceCatalog } from './catalog'

export const salesforceIntegration: IntegrationDefinition = {
  id: 'salesforce',
  catalog: salesforceCatalog,
  oauth: {
    stateType: 'salesforce_oauth',
    buildAuthUrl: getSalesforceOAuthUrl,
    exchangeCode: exchangeSalesforceCode,
  },
  hook: salesforceHook,
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
