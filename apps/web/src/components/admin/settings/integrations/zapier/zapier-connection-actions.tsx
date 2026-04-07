import { WebhookConnectionActions } from '../webhook-connection-actions'
import { saveZapierWebhookFn } from '@/lib/server/integrations/zapier/functions'

interface ZapierConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
  webhookUrl?: string
}

export function ZapierConnectionActions({
  integrationId,
  isConnected,
  webhookUrl,
}: ZapierConnectionActionsProps) {
  return (
    <WebhookConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      webhookUrl={webhookUrl}
      saveFn={saveZapierWebhookFn}
      displayName="Zapier"
      disconnectDescription="This will remove the Zapier integration and stop all webhook notifications. You can reconnect at any time."
      urlLabel="Webhook URL"
      urlPlaceholder="https://hooks.zapier.com/hooks/catch/..."
    />
  )
}
