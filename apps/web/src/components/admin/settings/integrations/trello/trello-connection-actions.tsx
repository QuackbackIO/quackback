import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getTrelloConnectUrl } from '@/lib/server/integrations/trello/functions'

interface TrelloConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function TrelloConnectionActions({
  integrationId,
  isConnected,
}: TrelloConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="trello"
      getConnectUrl={getTrelloConnectUrl}
      displayName="Trello"
      disconnectDescription="This will remove the Trello integration and stop creating cards for new feedback. You can reconnect at any time."
    />
  )
}
