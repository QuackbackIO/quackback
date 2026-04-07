import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getTeamsConnectUrl } from '@/lib/server/integrations/teams/functions'

interface TeamsConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function TeamsConnectionActions({
  integrationId,
  isConnected,
}: TeamsConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="teams"
      getConnectUrl={getTeamsConnectUrl}
      displayName="Teams"
      disconnectDescription="This will remove the Teams integration and stop all notifications. You can reconnect at any time."
    />
  )
}
