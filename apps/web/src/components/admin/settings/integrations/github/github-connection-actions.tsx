import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getGitHubConnectUrl } from '@/lib/server/integrations/github/functions'

interface GitHubConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function GitHubConnectionActions({
  integrationId,
  isConnected,
}: GitHubConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="github"
      getConnectUrl={getGitHubConnectUrl}
      displayName="GitHub"
      disconnectDescription="This will remove the GitHub integration and stop all issue syncing. You can reconnect at any time."
    />
  )
}
