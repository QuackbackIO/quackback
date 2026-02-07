/**
 * Azure DevOps inbound webhook handler.
 *
 * Receives webhook events from Azure DevOps and extracts work item status changes.
 * Authentication: HTTPS Basic Auth — the secret is the expected Basic Auth password.
 * Status field: `resource.fields["System.State"].newValue`.
 */

import { timingSafeEqual } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

export const azureDevOpsInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, _body: string, secret: string): Promise<true | Response> {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Basic ')) {
      return new Response('Missing Basic Auth', { status: 401 })
    }

    // Decode Basic Auth and compare password
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString()
    const password = decoded.split(':')[1] ?? ''

    const valid =
      password.length === secret.length &&
      timingSafeEqual(Buffer.from(password), Buffer.from(secret))

    if (!valid) {
      return new Response('Invalid credentials', { status: 401 })
    }

    return true
  },

  async parseStatusChange(body: string): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body)

    // Azure DevOps sends `workitem.updated` events
    if (payload.eventType !== 'workitem.updated') {
      return null
    }

    const resource = payload.resource
    if (!resource) return null

    const workItemId = resource.workItemId ?? resource.id
    if (!workItemId) return null

    // Check if System.State changed
    const stateField = resource.fields?.['System.State']
    if (!stateField?.newValue) return null

    return {
      externalId: String(workItemId),
      externalStatus: stateField.newValue,
      eventType: 'workitem.updated',
    }
  },
}
