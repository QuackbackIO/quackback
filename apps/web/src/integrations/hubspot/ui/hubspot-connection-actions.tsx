import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getHubSpotConnectUrl } from '@/integrations/hubspot/server/functions'

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
