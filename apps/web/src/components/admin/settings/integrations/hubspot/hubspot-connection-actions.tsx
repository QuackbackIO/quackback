import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getHubSpotConnectUrl } from '@/lib/server/integrations/hubspot/functions'

interface HubSpotConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function HubSpotConnectionActions({
  integrationId,
  isConnected,
}: HubSpotConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="hubspot"
      getConnectUrl={getHubSpotConnectUrl}
      displayName="HubSpot"
      disconnectDescription="This will remove the HubSpot integration and stop syncing CRM data. You can reconnect at any time."
    />
  )
}
