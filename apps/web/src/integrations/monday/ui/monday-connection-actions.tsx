import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getMondayConnectUrl } from '@/integrations/monday/server/functions'

interface MondayConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function MondayConnectionActions({
  integrationId,
  isConnected,
}: MondayConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="monday"
      getConnectUrl={getMondayConnectUrl}
      displayName="Monday.com"
      disconnectDescription="This will remove the Monday.com integration and stop all synchronization. You can reconnect at any time."
    />
  )
}
