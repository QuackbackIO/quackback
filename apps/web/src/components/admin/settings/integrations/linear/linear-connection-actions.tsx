import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getLinearConnectUrl } from '@/lib/server/integrations/linear/functions'

interface LinearConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function LinearConnectionActions({
  integrationId,
  isConnected,
}: LinearConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="linear"
      getConnectUrl={getLinearConnectUrl}
      displayName="Linear"
      disconnectDescription="This will remove the Linear integration and stop all issue syncing. You can reconnect at any time."
    />
  )
}
