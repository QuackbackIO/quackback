/**
 * Jira webhook registration.
 *
 * Uses Jira REST API to create/delete webhooks for issue status sync.
 * Note: Jira Cloud webhooks expire after 30 days by default.
 */

interface JiraWebhookResult {
  webhookId: string
}

/**
 * Register a webhook with Jira to receive issue update events.
 */
export async function registerJiraWebhook(
  accessToken: string,
  cloudId: string,
  callbackUrl: string,
  _secret: string
): Promise<JiraWebhookResult> {
  const response = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook`, {
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
          jqlFilter: 'project is not EMPTY',
          events: ['jira:issue_updated'],
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Jira API error ${response.status}: ${body}`)
  }

  const result = (await response.json()) as {
    webhookRegistrationResult?: Array<{ createdWebhookId?: number }>
  }
  const webhookId = result.webhookRegistrationResult?.[0]?.createdWebhookId
  if (!webhookId) {
    throw new Error('No webhook ID returned from Jira')
  }

  return { webhookId: String(webhookId) }
}

/**
 * Delete a webhook from Jira.
 */
export async function deleteJiraWebhook(
  accessToken: string,
  cloudId: string,
  webhookId: string
): Promise<void> {
  await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ webhookIds: [Number(webhookId)] }),
  })
}
