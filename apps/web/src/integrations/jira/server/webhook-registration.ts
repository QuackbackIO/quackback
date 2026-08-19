/**
 * Jira dynamic webhook registration for inbound status sync.
 *
 * Uses POST /rest/api/3/webhook (Connect / OAuth 2.0). That API accepts only
 * `=`, `!=`, `IN`, `NOT IN` in jqlFilter — not `IS` / `IS NOT`.
 * Dynamic webhooks have no HMAC secret field.
 */

interface JiraWebhookResult {
  webhookId: string
}

const PROJECT_REF = /^[A-Za-z0-9_]+$/

export async function registerJiraWebhook(
  accessToken: string,
  cloudId: string,
  callbackUrl: string,
  projectRef: string
): Promise<JiraWebhookResult> {
  if (!PROJECT_REF.test(projectRef)) {
    throw new Error('Invalid Jira project reference')
  }

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
          jqlFilter: `project = ${projectRef}`,
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
    webhookRegistrationResult?: Array<{ createdWebhookId?: number; errors?: string[] }>
  }
  const first = result.webhookRegistrationResult?.[0]
  if (!first?.createdWebhookId) {
    const detail = first?.errors?.join('; ')
    throw new Error(detail || 'No webhook ID returned from Jira')
  }

  return { webhookId: String(first.createdWebhookId) }
}

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
