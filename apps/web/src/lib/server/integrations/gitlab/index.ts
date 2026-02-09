import type { IntegrationDefinition } from '../types'
import { gitlabHook } from './hook'
import { getGitLabOAuthUrl, exchangeGitLabCode } from './oauth'
import { gitlabCatalog } from './catalog'
import { gitlabInboundHandler } from './inbound'

export const gitlabIntegration: IntegrationDefinition = {
  id: 'gitlab',
  catalog: gitlabCatalog,
  oauth: {
    stateType: 'gitlab_oauth',
    buildAuthUrl: getGitLabOAuthUrl,
    exchangeCode: exchangeGitLabCode,
  },
  hook: gitlabHook,
  inbound: gitlabInboundHandler,
  platformCredentials: [
    {
      key: 'clientId',
      label: 'Application ID',
      sensitive: false,
      helpUrl: 'https://gitlab.com/-/user_settings/applications',
    },
    {
      key: 'clientSecret',
      label: 'Secret',
      sensitive: true,
      helpUrl: 'https://gitlab.com/-/user_settings/applications',
    },
  ],
}
