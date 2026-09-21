import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Salesforce hook handler.
 * Enriches feedback posts with CRM data from Salesforce.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'salesforce' })

export interface SalesforceTarget {
  channelId: string
}

export interface SalesforceConfig {
  accessToken: string
  rootUrl: string
  instanceUrl?: string
}

export const salesforceHook: IntegrationHook = {
  async run(event: EventData, _target: unknown, config: unknown): Promise<DeliveryOutcome> {
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    const { accessToken, instanceUrl } = config as SalesforceConfig
    const email = event.data.post.authorEmail

    if (!email || !instanceUrl) {
      return { state: 'succeeded' }
    }

    log.debug('enriching feedback')

    try {
      // SOQL query to find contact by email — escape backslashes then single quotes
      const safeEmail = email.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      const query = `SELECT Id, Name, AccountId, Account.Name FROM Contact WHERE Email = '${safeEmail}' LIMIT 1`
      const response = await integrationFetch(
        `${instanceUrl}/services/data/v62.0/query?q=${encodeURIComponent(query)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const data = (await response.json()) as {
        records: Array<{
          Id: string
          Name: string
          AccountId?: string
          Account?: { Name: string }
        }>
      }

      if (data.records.length === 0) {
        log.debug('no contact found')
        return { state: 'succeeded' }
      }

      const contact = data.records[0]
      log.info({ contact_id: contact.Id }, 'contact found')

      return {
        state: 'succeeded',
        result: {
          externalId: contact.Id,
          externalUrl: `${instanceUrl}/lightning/r/Contact/${contact.Id}/view`,
        },
      }
    } catch (error) {
      log.error({ err: error }, 'enrichment failed')
      return deliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken, instanceUrl } = config as SalesforceConfig
    try {
      const response = await integrationFetch(`${instanceUrl}/services/data/v62.0/`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
