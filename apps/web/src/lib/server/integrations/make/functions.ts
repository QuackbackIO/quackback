/**
 * Make-specific server functions.
 * Make uses webhook URLs (no OAuth).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

/**
 * Save a Make webhook URL as the integration connection.
 */
export const saveMakeWebhookFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ webhookUrl: z.string().url().startsWith('https://') }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { saveIntegration } = await import('../save')

    const auth = await requireAuth({ roles: ['admin'] })

    // Test the webhook with a ping
    const testResponse = await fetch(data.webhookUrl, {
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

    await saveIntegration('make', {
      principalId: auth.principal.id,
      accessToken: data.webhookUrl,
      config: { webhookUrl: data.webhookUrl, workspaceName: 'Make' },
    })

    return { success: true }
  })
