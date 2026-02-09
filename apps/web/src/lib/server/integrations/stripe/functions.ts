/**
 * Stripe-specific server functions.
 * Stripe uses an API key (no OAuth) — admin pastes their restricted key.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

/**
 * Save a Stripe API key as the integration connection.
 */
export const saveStripeKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ apiKey: z.string().startsWith('rk_').or(z.string().startsWith('sk_')) })
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../../functions/auth-helpers')
    const { saveIntegration } = await import('../save')

    const auth = await requireAuth({ roles: ['admin'] })

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
