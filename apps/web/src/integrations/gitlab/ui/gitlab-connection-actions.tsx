import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getGitLabConnectUrl } from '@/integrations/gitlab/server/functions'

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
