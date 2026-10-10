import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getGitHubConnectUrl } from '@/integrations/github/server/functions'

interface GitHubConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
  returnPath?: string
}

export function GitHubConnectionActions({
  integrationId,
  isConnected,
  returnPath,
}: GitHubConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="github"
      getConnectUrl={() =>
        returnPath ? getGitHubConnectUrl({ data: { returnPath } }) : getGitHubConnectUrl()
      }
      displayName="GitHub"
      connectLabel="Connect GitHub"
      disconnectDescription="This will remove the GitHub integration and stop all issue syncing. You can reconnect at any time."
    />
  )
}
