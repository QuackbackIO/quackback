/**
 * Jira inbound webhook handler.
 *
 * OAuth 2.0 dynamic webhooks authenticate with a bearer JWT signed by the
 * app client secret — not HMAC X-Hub-Signature (that is the admin-webhook API).
 * Status field: changelog.items[] where field === 'status' → toString.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

function verifyHs256Jwt(token: string, secret: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [header, payload, signature] = parts
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: unknown }
    return typeof claims.exp === 'number' && claims.exp * 1000 > Date.now()
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

    if (!verifyHs256Jwt(token, clientSecret)) {
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
