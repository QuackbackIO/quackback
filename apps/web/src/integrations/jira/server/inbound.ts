/**
 * Jira inbound webhook handler.
 *
 * OAuth 2.0 dynamic webhooks authenticate with a bearer JWT signed by the
 * app client secret — not HMAC X-Hub-Signature (that is the admin-webhook API).
 * Status field: changelog.items[] where field === 'status' → toString.
 */

import { jwtVerify } from 'jose'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'

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

  async parseStatusChange(body: string): Promise<InboundWebhookResult | null> {
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
    if (!issueKey) return null

    return {
      externalId: issueKey,
      externalStatus: statusChange.toString,
      eventType: 'jira:issue_updated',
    }
  },
}
