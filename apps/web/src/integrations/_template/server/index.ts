/**
 * Executable example for a fictional API. Replace its endpoints and auth with
 * the provider's protocol, then register the server definition and settings UI.
 * Tests load this definition as a new provider without modifying shared sync code.
 * It stays unavailable in the live catalog.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IntegrationDefinition, DestinationItem } from '@/lib/server/integrations/types'
import { channelDestination } from '@/lib/server/integrations/destination'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { templateCatalog } from './catalog'

const API = 'https://api.example.invalid'
async function list(path: string, accessToken: string): Promise<DestinationItem[]> {
  const response = await integrationFetch(`${API}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok)
    throw Object.assign(new Error('Could not list destinations'), { status: response.status })
  return response.json()
}

export const templateIntegration: IntegrationDefinition = {
  id: 'template',
  catalog: templateCatalog,
  platformCredentials: [],
  // accountKey deliberately differs from existing providers: scope belongs here.
  destination: channelDestination(['accountKey']),
  linkedItems: true,
  hook: {
    async run(event, target, credentials) {
      if (event.type !== 'post.created') return { state: 'succeeded' }
      const auth = credentials as { accessToken: string }
      const destination = (target as { channelId: string }).channelId
      try {
        const response = await integrationFetch(`${API}/items`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            destination,
            title: event.data.post.title,
            content: event.data.post.content,
          }),
        })
        if (!response.ok) return httpDeliveryFailure(response)
        const item = (await response.json()) as { id: string; url: string }
        return {
          state: 'succeeded',
          result: { externalId: item.id, externalDisplayId: item.id, externalUrl: item.url },
        }
      } catch (error) {
        return deliveryError(error)
      }
    },
  },
  destinations: {
    project: { label: 'Project', list: ({ accessToken }) => list('projects', accessToken) },
    'issue-type': {
      label: 'Issue type',
      childOf: 'project',
      list: ({ accessToken, parentId }) =>
        parentId
          ? list(`projects/${encodeURIComponent(parentId)}/types`, accessToken)
          : Promise.resolve([]),
    },
  },
  inbound: {
    statusMode: 'review',
    async verifySignature(request, body, secret) {
      const signature = request.headers.get('x-signature') ?? ''
      const expected = createHmac('sha256', secret).update(body).digest('hex')
      return signature.length === expected.length &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        ? true
        : new Response(null, { status: 401 })
    },
    async parseStatusChange(body) {
      const item = JSON.parse(body)
      if (
        item.type !== 'item.updated' ||
        typeof item.id !== 'string' ||
        typeof item.status !== 'string'
      )
        return null
      return {
        externalId: item.id,
        externalStatus: item.status,
        eventType: item.type,
        destinationId: typeof item.projectId === 'string' ? item.projectId : undefined,
      }
    },
  },
  webhookRegistration: 'manual',
  listExternalStatuses: async () => [{ id: 'Done', name: 'Done' }],
  // A provider may also supply context without any outbound hook or linked items.
  context: async ({ accessToken, email }) => {
    const response = await integrationFetch(`${API}/contacts?${new URLSearchParams({ email })}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok)
      throw Object.assign(new Error('Could not look up customer'), { status: response.status })
    const contact = (await response.json()) as { name?: string } | null
    return contact ? { provider: 'template', name: contact.name, fields: [] } : null
  },
}
