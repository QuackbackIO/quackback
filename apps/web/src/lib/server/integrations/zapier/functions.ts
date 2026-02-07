/**
 * Zapier-specific server functions.
 * Zapier uses webhook URLs (no OAuth) - the user pastes a webhook URL.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

/**
 * Save a Zapier webhook URL as the integration connection.
 */
export const saveZapierWebhookFn = createServerFn({ method: 'POST' })
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

    await saveIntegration('zapier', {
      memberId: auth.member.id,
      accessToken: data.webhookUrl,
      config: { webhookUrl: data.webhookUrl, workspaceName: 'Zapier' },
    })

    return { success: true }
  })
