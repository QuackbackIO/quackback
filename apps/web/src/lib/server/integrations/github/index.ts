import type { IntegrationDefinition } from '../types'
import { githubHook } from './hook'
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
  requiredEnvVars: ['GITHUB_INTEGRATION_CLIENT_ID', 'GITHUB_INTEGRATION_CLIENT_SECRET'],
  onDisconnect: (secrets) => revokeGitHubToken(secrets.accessToken as string),
}
