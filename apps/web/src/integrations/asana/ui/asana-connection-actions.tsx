import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getAsanaConnectUrl } from '@/integrations/asana/server/functions'

interface AsanaConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function AsanaConnectionActions({
  integrationId,
  isConnected,
}: AsanaConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="asana"
      getConnectUrl={getAsanaConnectUrl}
      displayName="Asana"
      disconnectDescription="This will remove the Asana integration and stop all task syncing. You can reconnect at any time."
    />
  )
}
