import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getJiraConnectUrl } from '@/integrations/jira/server/functions'

interface JiraConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function JiraConnectionActions({ integrationId, isConnected }: JiraConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="jira"
      getConnectUrl={getJiraConnectUrl}
      displayName="Jira"
      disconnectDescription="This will remove the Jira integration and stop all issue syncing. You can reconnect at any time."
    />
  )
}
