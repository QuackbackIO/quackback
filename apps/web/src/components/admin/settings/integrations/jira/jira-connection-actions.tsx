import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getJiraConnectUrl } from '@/lib/server/integrations/jira/functions'

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
