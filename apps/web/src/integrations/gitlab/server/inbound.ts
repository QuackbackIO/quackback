/**
 * GitLab inbound webhook handler.
 * Receives issue state change events for two-way status sync.
 * Authentication: shared secret in the `X-Gitlab-Token` header.
 * Issue numbers (`iid`) are only unique within a project, and the webhook can be
 * registered on a group, so events from other projects are ignored.
 * The body is unsigned, so the event is only a trigger: the issue is read back
 * from the connected project, which also proves it belongs to that project.
 */

import { timingSafeEqual } from 'crypto'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'
import { getGitLabIssueState } from '@/integrations/gitlab/server/issues'

// Map GitLab states: opened, closed
const STATUS_MAP: Record<string, string> = {
  opened: 'Open',
  closed: 'Closed',
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

export const gitlabInboundHandler: InboundWebhookHandler = {
  statusMode: 'automatic',
  async verifySignature(request: Request, _body: string, secret: string): Promise<true | Response> {
    // GitLab uses a shared secret token in the X-Gitlab-Token header
    const token = request.headers.get('X-Gitlab-Token')
    if (!token) {
      return new Response('Missing token', { status: 401 })
    }

    const expected = Buffer.from(secret)
    const actual = Buffer.from(token)

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return new Response('Invalid token', { status: 401 })
    }

    return true
  },

  async parseStatusChange(
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body) as {
      object_kind?: string
      project?: { id?: number | string }
      changes?: { state_id?: unknown }
      object_attributes?: {
        iid?: number
        action?: string
        state?: string
      }
    }

    if (payload.object_kind !== 'issue') return null
    if (!payload.object_attributes?.iid) return null

    const { action, state, iid } = payload.object_attributes
    const stateChanged =
      action === 'close' ||
      action === 'reopen' ||
      (action === 'update' && !!payload.changes?.state_id)
    if (!stateChanged || !state) return null

    const configuredProject = typeof config.channelId === 'string' ? config.channelId : null
    if (configuredProject && String(payload.project?.id ?? '') !== configuredProject) return null

    const externalId = String(iid)
    const accessToken = typeof secrets.accessToken === 'string' ? secrets.accessToken : null
    if (!configuredProject || !accessToken) {
      const externalStatus = STATUS_MAP[state]
      if (!externalStatus) return null
      return { externalId, externalStatus, eventType: 'issue.state_changed' }
    }

    const instanceUrl = typeof config.instanceUrl === 'string' ? config.instanceUrl : null
    const current = await getGitLabIssueState(
      accessToken,
      instanceUrl,
      configuredProject,
      externalId
    )
    if (!current || current.projectId !== configuredProject) return null

    const externalStatus = current.state ? STATUS_MAP[current.state] : undefined
    if (!externalStatus) return null

    return {
      externalId,
      externalStatus,
      eventType: 'issue.state_changed',
      destinationId: configuredProject,
      occurredAt: isoDate(current.updatedAt),
    }
  },
}
