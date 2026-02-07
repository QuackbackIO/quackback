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
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://developers.hubspot.com/',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://developers.hubspot.com/',
    },
  ],
  onDisconnect: (secrets, _config, credentials) =>
    revokeHubSpotToken(secrets.refreshToken as string, credentials),
}
