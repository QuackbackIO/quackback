import { WebhookConnectionActions } from '../webhook-connection-actions'
import { saveN8nWebhookFn } from '@/lib/server/integrations/n8n/functions'

interface N8nConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
  webhookUrl?: string
}

export function N8nConnectionActions({
  integrationId,
  isConnected,
  webhookUrl,
}: N8nConnectionActionsProps) {
  return (
    <WebhookConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      webhookUrl={webhookUrl}
      saveFn={saveN8nWebhookFn}
      displayName="n8n"
      disconnectDescription="This will remove the n8n integration and stop all webhook notifications. You can reconnect at any time."
      urlLabel="n8n Webhook URL"
      urlPlaceholder="https://your-n8n-instance.com/webhook/..."
      helpText="Create a Webhook node in n8n and paste the production webhook URL here"
    />
  )
}
