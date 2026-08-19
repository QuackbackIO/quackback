/**
 * Stripe-specific server functions.
 * Stripe uses an API key (no OAuth) — admin pastes their restricted key.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * Save a Stripe API key as the integration connection.
 */
export const saveStripeKeyFn = createServerFn({ method: 'POST' })
  .validator(z.object({ apiKey: z.string().startsWith('rk_').or(z.string().startsWith('sk_')) }))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { saveIntegration } = await import('@/lib/server/integrations/save')

    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    // Test the key
    const response = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${data.apiKey}` },
    })

    if (!response.ok) {
      throw new Error(`Invalid Stripe API key: HTTP ${response.status}`)
    }

    await saveIntegration('stripe', {
      principalId: auth.principal.id,
      accessToken: data.apiKey,
      config: { workspaceName: 'Stripe' },
    })

    return { success: true }
  })
