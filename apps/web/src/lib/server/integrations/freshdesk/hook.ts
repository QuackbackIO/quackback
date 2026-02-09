/**
 * Freshdesk hook handler.
 * Enriches feedback posts with support ticket data from Freshdesk.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'

export interface FreshdeskTarget {
  channelId: string
}

export interface FreshdeskConfig {
  accessToken: string
  rootUrl: string
  subdomain?: string
}

export const freshdeskHook: HookHandler = {
  async run(event: EventData, _target: unknown, config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created') {
      return { success: true }
    }

    const { accessToken, subdomain } = config as FreshdeskConfig
    const email = event.data.post.authorEmail

    if (!email || !subdomain) {
      return { success: true }
    }

    console.log(`[Freshdesk] Enriching feedback from ${email}`)

    try {
      const response = await fetch(
        `https://${subdomain}.freshdesk.com/api/v2/contacts?email=${encodeURIComponent(email)}`,
        {
          headers: { Authorization: `Basic ${btoa(`${accessToken}:X`)}` },
        }
      )

      if (!response.ok) {
        const status = response.status

        if (status === 401 || status === 403) {
          return {
            success: false,
            error: `Freshdesk authentication failed (${status}).`,
            shouldRetry: false,
          }
        }

        return {
          success: false,
          error: `Freshdesk API error: ${status}`,
          shouldRetry: status === 429 || status >= 500,
        }
      }

      const contacts = (await response.json()) as Array<{ id: number; name?: string }>

      if (contacts.length === 0) {
        console.log(`[Freshdesk] No contact found for ${email}`)
        return { success: true }
      }

      const contact = contacts[0]
      console.log(`[Freshdesk] ✅ Found contact ${contact.id}`)

      return {
        success: true,
        externalId: String(contact.id),
        externalUrl: `https://${subdomain}.freshdesk.com/a/contacts/${contact.id}`,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Freshdesk] ❌ Exception: ${errorMsg}`)
      return { success: false, error: errorMsg, shouldRetry: isRetryableError(error) }
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken, subdomain } = config as FreshdeskConfig
    try {
      const response = await fetch(`https://${subdomain}.freshdesk.com/api/v2/settings/helpdesk`, {
        headers: { Authorization: `Basic ${btoa(`${accessToken}:X`)}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}
