import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getIntercomConnectUrl } from '@/lib/server/integrations/intercom/functions'

interface IntercomConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function IntercomConnectionActions({
  integrationId,
  isConnected,
}: IntercomConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="intercom"
      getConnectUrl={getIntercomConnectUrl}
      displayName="Intercom"
      disconnectDescription="This will remove the Intercom integration and stop syncing customer data. You can reconnect at any time."
    />
  )
}
