import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getGitLabConnectUrl } from '@/lib/server/integrations/gitlab/functions'

interface GitLabConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function GitLabConnectionActions({
  integrationId,
  isConnected,
}: GitLabConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="gitlab"
      getConnectUrl={getGitLabConnectUrl}
      displayName="GitLab"
      disconnectDescription="This will remove the GitLab integration and stop all synchronization. You can reconnect at any time."
    />
  )
}
