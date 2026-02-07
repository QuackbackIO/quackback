/**
 * Linear webhook registration.
 *
 * Uses Linear's GraphQL API to create/delete webhooks for status sync.
 */

const LINEAR_API = 'https://api.linear.app/graphql'

interface LinearWebhookResult {
  webhookId: string
}

/**
 * Register a webhook with Linear to receive issue updates.
 */
export async function registerLinearWebhook(
  accessToken: string,
  callbackUrl: string,
  secret: string,
  teamId?: string
): Promise<LinearWebhookResult> {
  const variables: Record<string, unknown> = {
    input: {
      url: callbackUrl,
      resourceTypes: ['Issue'],
      secret,
      ...(teamId ? { teamId } : {}),
    },
  }

  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: CREATE_WEBHOOK_MUTATION,
      variables,
    }),
  })

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status}`)
  }

  const result = (await response.json()) as {
    data?: { webhookCreate?: { success: boolean; webhook?: { id: string } } }
    errors?: Array<{ message: string }>
  }

  if (result.errors?.length) {
    const msg = result.errors[0].message
    if (msg.toLowerCase().includes('admin')) {
      throw new Error(
        'The connected Linear account must have admin permissions to create webhooks. ' +
          'Please reconnect with a workspace admin account.'
      )
    }
    throw new Error(`Linear API error: ${msg}`)
  }

  const webhook = result.data?.webhookCreate?.webhook
  if (!webhook) {
    throw new Error('No webhook returned from Linear')
  }

  return { webhookId: webhook.id }
}

/**
 * Delete a webhook from Linear.
 */
export async function deleteLinearWebhook(accessToken: string, webhookId: string): Promise<void> {
  await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: DELETE_WEBHOOK_MUTATION,
      variables: { id: webhookId },
    }),
  })
}

const CREATE_WEBHOOK_MUTATION = `
  mutation CreateWebhook($input: WebhookCreateInput!) {
    webhookCreate(input: $input) {
      success
      webhook {
        id
      }
    }
  }
`

const DELETE_WEBHOOK_MUTATION = `
  mutation DeleteWebhook($id: String!) {
    webhookDelete(id: $id) {
      success
    }
  }
`
