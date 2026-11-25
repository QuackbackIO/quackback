/**
 * Jira inbound webhook handler.
 *
 * OAuth 2.0 dynamic webhooks authenticate with a bearer JWT signed by the
 * app client secret, not HMAC X-Hub-Signature (that is the admin-webhook API).
 * The token carries no body hash, so it proves the sender but not the body.
 * A status changelog entry is only a trigger: the issue is read back from the
 * connected site and must belong to the connected project.
 */

import { jwtVerify } from 'jose'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'
import { getJiraIssueStatus, type JiraIssueStatus } from '@/integrations/jira/server/issues'
import { jiraProjectRef } from '@/integrations/jira/server/webhook-registration'

/** True or false when the project can be compared, null when either side is unknown. */
function matchesProject(projectRef: string, issue: JiraIssueStatus): boolean | null {
  if (!projectRef) return null
  // The ref is a numeric project id; legacy configs hold a project key.
  if (/^\d+$/.test(projectRef)) {
    return issue.projectId ? issue.projectId === projectRef : null
  }
  return issue.projectKey ? issue.projectKey.toLowerCase() === projectRef.toLowerCase() : null
}

/** Jira sends `+0000` style offsets; add the colon so parsing does not rely on engine leniency. */
function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const ms = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

async function verifyHs256Jwt(token: string, secret: string): Promise<boolean> {
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      clockTolerance: '60s',
    })
    return true
  } catch {
    return false
  }
}

export const jiraInboundHandler: InboundWebhookHandler = {
  statusMode: 'automatic',
  async verifySignature(request: Request): Promise<true | Response> {
    const raw = request.headers.get('Authorization')
    const token = raw?.startsWith('Bearer ') ? raw.slice('Bearer '.length).trim() : ''
    if (!token) {
      return new Response('Missing bearer token', { status: 401 })
    }

    const { getPlatformCredentials } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    const credentials = await getPlatformCredentials('jira')
    const clientSecret = credentials?.clientSecret
    if (!clientSecret) {
      return new Response('Jira credentials not configured', { status: 401 })
    }

    if (!(await verifyHs256Jwt(token, clientSecret))) {
      return new Response('Invalid signature', { status: 401 })
    }

    return true
  },

  async parseStatusChange(
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body)

    if (
      !payload.webhookEvent?.includes('issue_updated') &&
      payload.webhookEvent !== 'jira:issue_updated'
    ) {
      return null
    }

    const statusChange = payload.changelog?.items?.find(
      (item: { field: string }) => item.field === 'status'
    )
    if (!statusChange) return null

    const issueKey = payload.issue?.key
    if (typeof issueKey !== 'string' || !issueKey) return null

    const eventType = 'jira:issue_updated'
    const cloudId = typeof config.cloudId === 'string' ? config.cloudId : null
    const token = typeof secrets.accessToken === 'string' ? secrets.accessToken : null
    if (!cloudId || !token) {
      return { externalId: issueKey, externalStatus: statusChange.toString, eventType }
    }

    // The issue id survives a project move; the key does not.
    const issueId = String(payload.issue?.id ?? '')
    const current = await getJiraIssueStatus(
      token,
      cloudId,
      /^\d+$/.test(issueId) ? issueId : issueKey
    )
    if (!current?.status) return null
    // The unsigned key picks the link, so it must name the issue that was read back.
    const sameIssue = current.key ? current.key.toUpperCase() === issueKey.toUpperCase() : null
    if (sameIssue === false) return null

    const channelId = typeof config.channelId === 'string' ? config.channelId : ''
    const projectMatch = matchesProject(jiraProjectRef(channelId), current)
    if (projectMatch === false) return null

    return {
      // Links store the key the issue had when linked; a moved issue keeps its old key there.
      externalId: issueKey,
      externalStatus: current.status,
      eventType,
      destinationId: projectMatch && sameIssue ? channelId : undefined,
      occurredAt: isoDate(current.updated),
    }
  },
}
