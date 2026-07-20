import { OAuthConnectionActions } from '@/components/admin/settings/integrations/oauth-connection-actions'
import { getDiscordConnectUrl } from '@/integrations/discord/server/functions'

interface DiscordConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function DiscordConnectionActions({
  integrationId,
  isConnected,
}: DiscordConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="discord"
      getConnectUrl={getDiscordConnectUrl}
      displayName="Discord"
      disconnectDescription="This will remove the Discord integration and stop all notifications. You can reconnect at any time."
    />
  )
}
