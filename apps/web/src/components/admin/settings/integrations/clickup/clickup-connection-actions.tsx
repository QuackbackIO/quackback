import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getClickUpConnectUrl } from '@/lib/server/integrations/clickup/functions'

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
