/**
 * Azure DevOps inbound webhook handler.
 *
 * Receives webhook events from Azure DevOps and extracts work item status changes.
 * Authentication: HTTPS Basic Auth — the secret is the expected Basic Auth password.
 * The body is unsigned, so the event is only a trigger: the work item is read back
 * from the connected organization. Matches on organization and project; the work
 * item type is ignored.
 */

import { timingSafeEqual } from 'crypto'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'
import { getWorkItemStatus, type WorkItemStatus } from '@/integrations/azure-devops/server/api'
import { organizationFromUrl } from '@/integrations/azure-devops/server/url'

function lowerCaseString(value: unknown): string | null {
  return typeof value === 'string' && value ? value.toLowerCase() : null
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

export const azureDevOpsInboundHandler: InboundWebhookHandler = {
  statusMode: 'automatic',
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

  async parseStatusChange(
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundWebhookResult | null> {
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

    const organization = lowerCaseString(
      organizationFromUrl(payload.resourceContainers?.account?.baseUrl)
    )
    const configuredOrganization =
      typeof config.organizationName === 'string' ? config.organizationName.toLowerCase() : null
    if (organization && configuredOrganization && organization !== configuredOrganization) {
      return null
    }

    const channelId = typeof config.channelId === 'string' ? config.channelId : ''
    const configuredProject = channelId.split(':')[0]?.toLowerCase() || null
    const eventProject = lowerCaseString(resource.revision?.fields?.['System.TeamProject'])
    if (eventProject && configuredProject && eventProject !== configuredProject) return null

    const externalId = String(workItemId)
    const pat = typeof secrets.accessToken === 'string' ? secrets.accessToken : null
    if (!configuredOrganization || !pat) {
      return { externalId, externalStatus: stateField.newValue, eventType: 'workitem.updated' }
    }

    let current: WorkItemStatus
    try {
      current = await getWorkItemStatus(pat, String(config.organizationName), externalId)
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
    if (!current.state) return null

    const project = lowerCaseString(current.project)
    if (project && configuredProject && project !== configuredProject) return null

    return {
      externalId,
      externalStatus: current.state,
      eventType: 'workitem.updated',
      destinationId: project && configuredProject ? channelId : undefined,
      occurredAt: isoDate(current.changedDate),
    }
  },
}
