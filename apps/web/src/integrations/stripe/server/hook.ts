import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Stripe hook handler.
 * Enriches feedback posts with customer revenue data from Stripe.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'stripe' })

const STRIPE_API = 'https://api.stripe.com/v1'

export interface StripeTarget {
  channelId: string // unused, but required by pattern
}

export interface StripeConfig {
  accessToken: string // Stripe secret key
  rootUrl: string
}

export const stripeHook: IntegrationHook = {
  async run(event: EventData, _target: unknown, config: unknown): Promise<DeliveryOutcome> {
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    const { accessToken } = config as StripeConfig
    const email = event.data.post.authorEmail

    if (!email) {
      log.debug('no author email, skipping enrichment')
      return { state: 'succeeded' }
    }

    log.debug('enriching feedback')

    try {
      // Search for customer by email
      const searchParams = new URLSearchParams({
        query: `email:'${email}'`,
        limit: '1',
      })
      const response = await integrationFetch(`${STRIPE_API}/customers/search?${searchParams}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const data = (await response.json()) as {
        data: Array<{
          id: string
          name?: string
          metadata?: Record<string, string>
        }>
      }

      if (data.data.length === 0) {
        log.debug('no customer found')
        return { state: 'succeeded' }
      }

      const customer = data.data[0]
      log.info({ customer_id: customer.id }, 'customer found')

      return {
        state: 'succeeded',
        result: {
          externalId: customer.id,
          externalUrl: `https://dashboard.stripe.com/customers/${customer.id}`,
        },
      }
    } catch (error) {
      log.error({ err: error }, 'enrichment failed')

      return deliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as StripeConfig
    try {
      const response = await integrationFetch(`${STRIPE_API}/balance`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
