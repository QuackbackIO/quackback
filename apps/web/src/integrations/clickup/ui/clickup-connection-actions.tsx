import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getClickUpConnectUrl } from '@/integrations/clickup/server/functions'

interface ClickUpConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function ClickUpConnectionActions({
  integrationId,
  isConnected,
}: ClickUpConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="clickup"
      getConnectUrl={getClickUpConnectUrl}
      displayName="ClickUp"
      disconnectDescription="This will remove the ClickUp integration and stop all task syncing. You can reconnect at any time."
    />
  )
}
