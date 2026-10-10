/**
 * GitHub webhook registration.
 *
 * Uses GitHub REST API to create/delete webhooks for issue status sync.
 */

const GITHUB_API = 'https://api.github.com'

interface GitHubWebhookResult {
  webhookId: string
}

const githubHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'quackback',
  'X-GitHub-Api-Version': '2022-11-28',
})

/**
 * Register a webhook with GitHub. `events` is computed from live inbox
 * state, never hardcoded, so reconnect cannot silently drop issue comments.
 */
export async function registerGitHubWebhook(
  accessToken: string,
  ownerRepo: string,
  callbackUrl: string,
  secret: string,
  events: string[] = ['issues']
): Promise<GitHubWebhookResult> {
  const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/hooks`, {
    method: 'POST',
    headers: githubHeaders(accessToken),
    body: JSON.stringify({
      name: 'web',
      active: true,
      events,
      config: {
        url: callbackUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub API error ${response.status}: ${body}`)
  }

  const hook = (await response.json()) as { id: number }
  return { webhookId: String(hook.id) }
}

/** PATCH an existing hook's events (and optionally its callback config). */
export async function patchGitHubWebhook(
  accessToken: string,
  ownerRepo: string,
  webhookId: string,
  events: string[],
  callbackUrl?: string,
  secret?: string
): Promise<void> {
  const body: Record<string, unknown> = { active: true, events }
  if (callbackUrl) {
    body.config = {
      url: callbackUrl,
      content_type: 'json',
      ...(secret ? { secret } : {}),
      insecure_ssl: '0',
    }
  }
  const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/hooks/${webhookId}`, {
    method: 'PATCH',
    headers: githubHeaders(accessToken),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub API error ${response.status}: ${text}`)
  }
}

export async function findGitHubWebhookByUrl(
  accessToken: string,
  ownerRepo: string,
  callbackUrl: string
): Promise<string | null> {
  const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/hooks?per_page=100`, {
    headers: githubHeaders(accessToken),
  })
  if (!response.ok) return null
  const hooks = (await response.json()) as Array<{ id: number; config?: { url?: string } }>
  const match = hooks.find((h) => h.config?.url === callbackUrl)
  return match ? String(match.id) : null
}

/**
 * Delete a webhook from GitHub.
 */
export async function deleteGitHubWebhook(
  accessToken: string,
  ownerRepo: string,
  webhookId: string
): Promise<void> {
  await fetch(`${GITHUB_API}/repos/${ownerRepo}/hooks/${webhookId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quackback',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
}
