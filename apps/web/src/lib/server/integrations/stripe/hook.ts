/**
 * Stripe hook handler.
 * Enriches feedback posts with customer revenue data from Stripe.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'

const STRIPE_API = 'https://api.stripe.com/v1'

export interface StripeTarget {
  channelId: string // unused, but required by pattern
}

export interface StripeConfig {
  accessToken: string // Stripe secret key
  rootUrl: string
}

export const stripeHook: HookHandler = {
  async run(event: EventData, _target: unknown, config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created') {
      return { success: true }
    }

    const { accessToken } = config as StripeConfig
    const email = event.data.post.authorEmail

    if (!email) {
      console.log(`[Stripe] No author email, skipping enrichment`)
      return { success: true }
    }

    console.log(`[Stripe] Enriching feedback from ${email}`)

    try {
      // Search for customer by email
      const searchParams = new URLSearchParams({
        query: `email:'${email}'`,
        limit: '1',
      })
      const response = await fetch(`${STRIPE_API}/customers/search?${searchParams}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const status = response.status

        if (status === 401 || status === 403) {
          return {
            success: false,
            error: `Stripe authentication failed (${status}). Please check your API key.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        return {
          success: false,
          error: `Stripe API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as {
        data: Array<{
          id: string
          name?: string
          metadata?: Record<string, string>
        }>
      }

      if (data.data.length === 0) {
        console.log(`[Stripe] No customer found for ${email}`)
        return { success: true }
      }

      const customer = data.data[0]
      console.log(`[Stripe] ✅ Found customer ${customer.id}`)

      return {
        success: true,
        externalId: customer.id,
        externalUrl: `https://dashboard.stripe.com/customers/${customer.id}`,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Stripe] ❌ Exception: ${errorMsg}`)

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as StripeConfig
    try {
      const response = await fetch(`${STRIPE_API}/balance`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
