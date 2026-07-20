/**
 * ClickUp webhook registration.
 *
 * Uses ClickUp API to create/delete webhooks for task status sync.
 */

const CLICKUP_API = 'https://api.clickup.com/api/v2'

interface ClickUpWebhookResult {
  webhookId: string
}

/**
 * Register a webhook with ClickUp to receive task status update events.
 */
export async function registerClickUpWebhook(
  accessToken: string,
  teamId: string,
  callbackUrl: string,
  _secret: string
): Promise<ClickUpWebhookResult> {
  const response = await fetch(`${CLICKUP_API}/team/${teamId}/webhook`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      endpoint: callbackUrl,
      events: ['taskStatusUpdated'],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`ClickUp API error ${response.status}: ${body}`)
  }

  const result = (await response.json()) as { id?: string; webhook?: { id?: string } }
  const webhookId = result.id ?? result.webhook?.id
  if (!webhookId) {
    throw new Error('No webhook ID returned from ClickUp')
  }

  return { webhookId }
}

/**
 * Delete a webhook from ClickUp.
 */
export async function deleteClickUpWebhook(accessToken: string, webhookId: string): Promise<void> {
  await fetch(`${CLICKUP_API}/webhook/${webhookId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
}
