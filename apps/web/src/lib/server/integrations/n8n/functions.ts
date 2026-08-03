/**
 * n8n-specific server functions.
 * n8n uses webhook URLs (no OAuth).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { safeFetch } from '../../content/ssrf-guard'
import { toIsoString } from '@/lib/shared/utils'

/**
 * Save an n8n webhook URL as the integration connection.
 */
export const saveN8nWebhookFn = createServerFn({ method: 'POST' })
  .validator(z.object({ webhookUrl: z.string().url().startsWith('https://') }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { saveIntegration } = await import('../save')

    const auth = await requireAuth({ roles: ['admin'] })

    // Test the webhook with a ping
    const testResponse = await safeFetch(data.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'test',
        timestamp: toIsoString(new Date()),
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
