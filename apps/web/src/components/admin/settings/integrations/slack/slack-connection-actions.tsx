import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getSlackConnectUrl } from '@/lib/server/integrations/slack/functions'

interface SlackConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function SlackConnectionActions({
  integrationId,
  isConnected,
}: SlackConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="slack"
      getConnectUrl={getSlackConnectUrl}
      displayName="Slack"
      disconnectDescription="This will remove the Slack integration and stop all notifications. You can reconnect at any time."
    />
  )
}
