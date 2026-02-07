import type { IntegrationDefinition } from '../types'
import { getHubSpotOAuthUrl, exchangeHubSpotCode, revokeHubSpotToken } from './oauth'
import { hubspotCatalog } from './catalog'

export const hubspotIntegration: IntegrationDefinition = {
  id: 'hubspot',
  catalog: hubspotCatalog,
  oauth: {
    stateType: 'hubspot_oauth',
    buildAuthUrl: getHubSpotOAuthUrl,
    exchangeCode: exchangeHubSpotCode,
  },
  // No hook — HubSpot is inbound (enrichment), not outbound (notifications)
  requiredEnvVars: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
  onDisconnect: (secrets) => revokeHubSpotToken(secrets.refreshToken as string),
}
