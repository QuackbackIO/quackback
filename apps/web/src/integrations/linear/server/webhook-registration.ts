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
 * Register a webhook with Linear to receive issue updates. Self-healing: if
 * Linear rejects the create because a webhook already exists at this callback
 * URL (a prior registration whose id we failed to persist), the stale webhook
 * is deleted and the create retried once, so re-enabling status sync recovers
 * instead of dead-ending on "url not unique".
 */
export async function registerLinearWebhook(
  accessToken: string,
  callbackUrl: string,
  secret: string,
  teamId?: string
): Promise<LinearWebhookResult> {
  try {
    return await createLinearWebhook(accessToken, callbackUrl, secret, teamId)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (!/not unique|already exists/i.test(msg)) throw error
    // Reclaim the orphaned webhook at this URL, then retry the create once.
    const staleId = await findLinearWebhookByUrl(accessToken, callbackUrl)
    if (!staleId) throw error
    await deleteLinearWebhook(accessToken, staleId)
    return createLinearWebhook(accessToken, callbackUrl, secret, teamId)
  }
}

async function createLinearWebhook(
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

/** Find the id of an existing Linear webhook whose url matches, if any. */
async function findLinearWebhookByUrl(
  accessToken: string,
  callbackUrl: string
): Promise<string | null> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: LIST_WEBHOOKS_QUERY }),
  })
  if (!response.ok) return null
  const result = (await response.json()) as {
    data?: { webhooks?: { nodes?: Array<{ id: string; url: string }> } }
  }
  return result.data?.webhooks?.nodes?.find((w) => w.url === callbackUrl)?.id ?? null
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

const LIST_WEBHOOKS_QUERY = `
  query Webhooks {
    webhooks {
      nodes {
        id
        url
      }
    }
  }
`
