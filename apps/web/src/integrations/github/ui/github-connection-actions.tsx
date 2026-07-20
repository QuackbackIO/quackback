import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getGitHubConnectUrl } from '@/integrations/github/server/functions'

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
