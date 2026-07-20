/**
 * Zapier-specific server functions.
 * Zapier uses webhook URLs (no OAuth) - the user pastes a webhook URL.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * Save a Zapier webhook URL as the integration connection.
 */
export const saveZapierWebhookFn = createServerFn({ method: 'POST' })
  .validator(z.object({ webhookUrl: z.string().url().startsWith('https://') }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { saveIntegration } = await import('@/lib/server/integrations/save')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    if (new URL(data.webhookUrl).hostname !== 'hooks.zapier.com') {
      throw new Error('Webhook URL must be a hooks.zapier.com URL')
    }

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

    await saveIntegration('zapier', {
      principalId: auth.principal.id,
      accessToken: data.webhookUrl,
      config: { webhookUrl: data.webhookUrl, channelId: data.webhookUrl, workspaceName: 'Zapier' },
    })

    return { success: true }
  })
