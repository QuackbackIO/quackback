import type { IntegrationDefinition } from '../types'
import { githubHook } from './hook'
import { githubInboundHandler } from './inbound'
import { getGitHubOAuthUrl, exchangeGitHubCode, revokeGitHubToken } from './oauth'
import { githubCatalog } from './catalog'

export const githubIntegration: IntegrationDefinition = {
  id: 'github',
  catalog: githubCatalog,
  oauth: {
    stateType: 'github_oauth',
    buildAuthUrl: getGitHubOAuthUrl,
    exchangeCode: exchangeGitHubCode,
  },
  hook: githubHook,
  inbound: githubInboundHandler,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Client ID',
      sensitive: false,
      helpUrl: 'https://github.com/settings/developers',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      sensitive: true,
      helpUrl: 'https://github.com/settings/developers',
    },
  ],
  onDisconnect: (secrets, _config, credentials) =>
    revokeGitHubToken(secrets.accessToken as string, credentials),
}
