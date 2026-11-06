/**
 * Jira dynamic webhook registration for inbound status sync.
 *
 * Uses POST /rest/api/3/webhook (Connect / OAuth 2.0). That API accepts only
 * `=`, `!=`, `IN`, `NOT IN` in jqlFilter — not `IS` / `IS NOT`.
 * Dynamic webhooks have no HMAC secret field.
 *
 * Dynamic webhooks expire 30 days after creation or after their last refresh.
 * PUT /rest/api/3/webhook/refresh extends them; the scheduling that calls it lives
 * in lib/server/integrations/jira-webhook-refresh-queue.ts.
 */
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

interface JiraWebhookResult {
  webhookId: string
}

export interface JiraWebhookRefresh {
  /** When Jira says the refreshed webhooks expire, or null when the response does not say. */
  expiresAt: Date | null
  /** Ids Jira could not refresh because the webhook no longer exists. */
  invalidWebhookIds: string[]
}

const PROJECT_REF = /^[A-Za-z0-9_]+$/
const WEBHOOK_ID = /^\d+$/
const WEBHOOK_LIST_PAGE_SIZE = 100
/** Far above any real install's webhook count; a list that never ends is an error, not a loop. */
const WEBHOOK_LIST_MAX_PAGES = 50

/** The project half of the `projectId:issueTypeId` composite stored as the channel id. */
export function jiraProjectRef(channelId: unknown): string {
  return String(channelId ?? '').split(':')[0]
}

export async function registerJiraWebhook(
  accessToken: string,
  cloudId: string,
  callbackUrl: string,
  projectRef: string
): Promise<JiraWebhookResult> {
  if (!PROJECT_REF.test(projectRef)) {
    throw new Error('Invalid Jira project reference')
  }

  const response = await integrationFetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: callbackUrl,
        webhooks: [
          {
            jqlFilter: `project = ${projectRef}`,
            events: ['jira:issue_updated'],
          },
        ],
      }),
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Jira API error ${response.status}: ${body}`)
  }

  const result = (await response.json()) as {
    webhookRegistrationResult?: Array<{ createdWebhookId?: number; errors?: string[] }>
  }
  const first = result.webhookRegistrationResult?.[0]
  if (!first?.createdWebhookId) {
    const detail = first?.errors?.join('; ')
    throw new Error(detail || 'No webhook ID returned from Jira')
  }

  return { webhookId: String(first.createdWebhookId) }
}

/**
 * Extend the given webhooks by another 30 days.
 *
 * A 404 means none of them exist, which is reported as every id being invalid so
 * the caller can register a replacement. Other failures throw, so the caller records
 * them and retries later rather than treating them as a lost webhook.
 */
export async function refreshJiraWebhooks(
  accessToken: string,
  cloudId: string,
  webhookIds: string[]
): Promise<JiraWebhookRefresh> {
  const numericIds = webhookIds.map((id) => {
    if (!WEBHOOK_ID.test(id)) throw new Error('Invalid Jira webhook ID')
    return Number(id)
  })

  const response = await integrationFetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook/refresh`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ webhookIds: numericIds }),
    }
  )

  if (response.status === 404) {
    return { expiresAt: null, invalidWebhookIds: webhookIds }
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Jira API error ${response.status}: ${body}`)
  }

  const result = (await response.json()) as { expirationDate?: unknown; invalidWebhooks?: unknown }
  return {
    expiresAt: parseExpirationDate(result.expirationDate),
    invalidWebhookIds: Array.isArray(result.invalidWebhooks)
      ? result.invalidWebhooks.map(String)
      : [],
  }
}

/**
 * The ids of the dynamic webhooks this app has registered on the site, read page by
 * page.
 *
 * A refresh cannot confirm that a webhook still exists: Jira ignores an id it does not
 * recognise and answers with the same success body, so the list is the proof. Any
 * non-2xx response throws, so the caller records a retry rather than trusting a refresh
 * it could not check.
 */
export async function listJiraWebhookIds(
  accessToken: string,
  cloudId: string
): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let page = 0; page < WEBHOOK_LIST_MAX_PAGES; page++) {
    const startAt = page * WEBHOOK_LIST_PAGE_SIZE
    const response = await integrationFetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook?startAt=${startAt}&maxResults=${WEBHOOK_LIST_PAGE_SIZE}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    )
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Jira API error ${response.status}: ${body}`)
    }

    const body = (await response.json()) as unknown
    // A bare array is the whole list; the paged shape carries its values under `values`.
    if (Array.isArray(body)) {
      addWebhookIds(ids, body)
      return ids
    }
    const values = isRecord(body) && Array.isArray(body.values) ? body.values : []
    addWebhookIds(ids, values)
    if (values.length === 0) return ids
    if (isRecord(body) && body.isLast === true) return ids
    if (isRecord(body) && typeof body.total === 'number' && startAt + values.length >= body.total) {
      return ids
    }
  }
  throw new Error('Jira webhook list did not end within the page limit')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function addWebhookIds(ids: Set<string>, items: unknown[]): void {
  for (const item of items) {
    if (!isRecord(item)) continue
    if (typeof item.id === 'number' || typeof item.id === 'string') ids.add(String(item.id))
  }
}

/** Jira reports the expiry as epoch milliseconds; an ISO string is accepted too. */
function parseExpirationDate(value: unknown): Date | null {
  let date: Date | null = null
  if (typeof value === 'number') date = new Date(value)
  else if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)
    date = new Date(Number.isFinite(numeric) ? numeric : value)
  }
  return date && !Number.isNaN(date.getTime()) ? date : null
}

export async function deleteJiraWebhook(
  accessToken: string,
  cloudId: string,
  webhookId: string
): Promise<void> {
  const response = await integrationFetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ webhookIds: [Number(webhookId)] }),
    }
  )
  // A webhook Jira no longer has is already gone, which is what the caller wanted.
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => '')
    throw new Error(`Jira API error ${response.status}: ${body}`)
  }
}
