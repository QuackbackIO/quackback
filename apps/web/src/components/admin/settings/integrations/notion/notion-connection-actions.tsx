import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getNotionConnectUrl } from '@/lib/server/integrations/notion/functions'

interface NotionConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function NotionConnectionActions({
  integrationId,
  isConnected,
}: NotionConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="notion"
      getConnectUrl={getNotionConnectUrl}
      displayName="Notion"
      disconnectDescription="This will remove the Notion integration and stop creating database items. You can reconnect at any time."
    />
  )
}
