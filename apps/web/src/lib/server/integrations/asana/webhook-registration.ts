/**
 * Asana webhook registration.
 *
 * Uses Asana API to create/delete webhooks for task status sync.
 * Asana uses a handshake protocol — the initial POST will trigger a
 * challenge that our inbound handler echoes back via X-Hook-Secret.
 */

const ASANA_API = 'https://app.asana.com/api/1.0'

interface AsanaWebhookResult {
  webhookId: string
}

/**
 * Register a webhook with Asana to receive task change events.
 */
export async function registerAsanaWebhook(
  accessToken: string,
  projectGid: string,
  callbackUrl: string
): Promise<AsanaWebhookResult> {
  const response = await fetch(`${ASANA_API}/webhooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        resource: projectGid,
        target: callbackUrl,
        filters: [
          {
            resource_type: 'task',
            action: 'changed',
            fields: ['memberships.section'],
          },
        ],
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Asana API error ${response.status}: ${body}`)
  }

  const result = (await response.json()) as { data?: { gid?: string } }
  const webhookId = result.data?.gid
  if (!webhookId) {
    throw new Error('No webhook ID returned from Asana')
  }

  return { webhookId }
}

/**
 * Delete a webhook from Asana.
 */
export async function deleteAsanaWebhook(accessToken: string, webhookId: string): Promise<void> {
  await fetch(`${ASANA_API}/webhooks/${webhookId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
}
