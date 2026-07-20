import { WebhookConnectionActions } from '@/components/admin/settings/integrations/webhook-connection-actions'
import { saveMakeWebhookFn } from '@/integrations/make/server/functions'

interface MakeConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
  webhookUrl?: string
}

export function MakeConnectionActions({
  integrationId,
  isConnected,
  webhookUrl,
}: MakeConnectionActionsProps) {
  return (
    <WebhookConnectionActions
      integrationId={integrationId}
      isConnected={isConnected}
      webhookUrl={webhookUrl}
      saveFn={saveMakeWebhookFn}
      displayName="Make"
      disconnectDescription="This will remove the Make integration and stop all webhook notifications. You can reconnect at any time."
      urlLabel="Make Webhook URL"
      urlPlaceholder="https://hook.us1.make.com/..."
      helpText="Create a Webhooks module in Make and paste the webhook URL here"
    />
  )
}
