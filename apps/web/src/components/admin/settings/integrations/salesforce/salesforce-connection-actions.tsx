import { OAuthConnectionActions } from '../oauth-connection-actions'
import { getSalesforceConnectUrl } from '@/lib/server/integrations/salesforce/functions'

interface SalesforceConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

export function SalesforceConnectionActions({
  integrationId,
  isConnected,
}: SalesforceConnectionActionsProps) {
  return (
    <OAuthConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      searchParamKey="salesforce"
      getConnectUrl={getSalesforceConnectUrl}
      displayName="Salesforce"
      disconnectDescription="This will remove the Salesforce integration and stop all CRM data enrichment. You can reconnect at any time."
    />
  )
}
