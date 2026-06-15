/**
 * Salesforce hook handler.
 * Enriches feedback posts with CRM data from Salesforce.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
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

export const salesforceHook: HookHandler = {
  async run(event: EventData, _target: unknown, config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created') {
      return { success: true }
    }

    const { accessToken, instanceUrl } = config as SalesforceConfig
    const email = event.data.post.authorEmail

    if (!email || !instanceUrl) {
      return { success: true }
    }

    log.debug('enriching feedback')

    try {
      // SOQL query to find contact by email — escape backslashes then single quotes
      const safeEmail = email.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      const query = `SELECT Id, Name, AccountId, Account.Name FROM Contact WHERE Email = '${safeEmail}' LIMIT 1`
      const response = await fetch(
        `${instanceUrl}/services/data/v62.0/query?q=${encodeURIComponent(query)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )

      if (!response.ok) {
        const status = response.status

        if (status === 401) {
          return {
            success: false,
            error: 'Salesforce authentication failed. Please reconnect.',
            shouldRetry: false,
          }
        }

        return {
          success: false,
          error: `Salesforce API error: ${status}`,
          shouldRetry: status === 429 || status >= 500,
        }
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
        return { success: true }
      }

      const contact = data.records[0]
      log.info({ contact_id: contact.Id }, 'contact found')

      return {
        success: true,
        externalId: contact.Id,
        externalUrl: `${instanceUrl}/lightning/r/Contact/${contact.Id}/view`,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error }, 'enrichment failed')
      return { success: false, error: errorMsg, shouldRetry: isRetryableError(error) }
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken, instanceUrl } = config as SalesforceConfig
    try {
      const response = await fetch(`${instanceUrl}/services/data/v62.0/`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
