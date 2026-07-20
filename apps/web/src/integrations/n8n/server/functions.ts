/**
 * n8n-specific server functions.
 * n8n uses webhook URLs (no OAuth).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * Save an n8n webhook URL as the integration connection.
 */
export const saveN8nWebhookFn = createServerFn({ method: 'POST' })
  .validator(z.object({ webhookUrl: z.string().url().startsWith('https://') }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { saveIntegration } = await import('@/lib/server/integrations/save')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    // Test the webhook with a ping
    const testResponse = await safeFetch(data.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'test',
        timestamp: new Date().toISOString(),
        message: 'Quackback webhook test',
      }),
    })

    if (!testResponse.ok) {
      throw new Error(`Webhook test failed: HTTP ${testResponse.status}`)
    }

    await saveIntegration('n8n', {
      principalId: auth.principal.id,
      accessToken: data.webhookUrl,
      config: { webhookUrl: data.webhookUrl, channelId: data.webhookUrl, workspaceName: 'n8n' },
    })

    return { success: true }
  })
