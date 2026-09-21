import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Freshdesk hook handler.
 * Enriches feedback posts with support ticket data from Freshdesk.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'freshdesk' })

export interface FreshdeskTarget {
  channelId: string
}

export interface FreshdeskConfig {
  accessToken: string
  rootUrl: string
  subdomain?: string
}

export const freshdeskHook: IntegrationHook = {
  async run(event: EventData, _target: unknown, config: unknown): Promise<DeliveryOutcome> {
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    const { accessToken, subdomain } = config as FreshdeskConfig
    const email = event.data.post.authorEmail

    if (!email || !subdomain) {
      return { state: 'succeeded' }
    }

    log.debug('enriching feedback')

    try {
      const response = await integrationFetch(
        `https://${subdomain}.freshdesk.com/api/v2/contacts?email=${encodeURIComponent(email)}`,
        {
          headers: { Authorization: `Basic ${btoa(`${accessToken}:X`)}` },
        }
      )

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const contacts = (await response.json()) as Array<{ id: number; name?: string }>

      if (contacts.length === 0) {
        log.debug('no contact found')
        return { state: 'succeeded' }
      }

      const contact = contacts[0]
      log.info({ contact_id: contact.id }, 'contact found')

      return {
        state: 'succeeded',
        result: {
          externalId: String(contact.id),
          externalUrl: `https://${subdomain}.freshdesk.com/a/contacts/${contact.id}`,
        },
      }
    } catch (error) {
      log.error({ err: error }, 'enrichment failed')
      return deliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken, subdomain } = config as FreshdeskConfig
    try {
      const response = await integrationFetch(
        `https://${subdomain}.freshdesk.com/api/v2/settings/helpdesk`,
        {
          headers: { Authorization: `Basic ${btoa(`${accessToken}:X`)}` },
        }
      )
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
