/**
 * The one place a Slack Web API client is made.
 *
 * In production it is `new WebClient(token, options)`, nothing added. Only in
 * an e2e run, behind the harness gate, does it point the SDK at the local
 * provider fake through `slackApiUrl` (see e2e-harness/provider-fake.ts).
 */
import { WebClient, type WebClientOptions } from '@slack/web-api'
import { e2eSlackApiUrl } from '@/lib/server/e2e-harness/provider-fake'

export function slackClient(token?: string, options?: WebClientOptions): WebClient {
  const slackApiUrl = e2eSlackApiUrl()
  if (slackApiUrl) return new WebClient(token, { ...options, slackApiUrl })
  return options === undefined ? new WebClient(token) : new WebClient(token, options)
}
