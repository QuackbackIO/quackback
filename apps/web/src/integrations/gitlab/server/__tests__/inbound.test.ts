/**
 * Tests for GitLab inbound webhook handler.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest'

const { gitlabFetch } = vi.hoisted(() => ({ gitlabFetch: vi.fn() }))
vi.mock('@/integrations/gitlab/server/fetch', () => ({ gitlabFetch }))

import { gitlabInboundHandler } from '@/integrations/gitlab/server/inbound'

const config = { channelId: '42' }
const secrets = { accessToken: 'tok' }

const parse = (
  payload: unknown,
  cfg: Record<string, unknown> = config,
  sec: Record<string, unknown> = secrets
) => gitlabInboundHandler.parseStatusChange(JSON.stringify(payload), cfg, sec)

function issueEvent(
  overrides: {
    action?: string
    state?: string
    projectId?: number
    changes?: Record<string, unknown>
  } = {}
) {
  return {
    object_kind: 'issue',
    project: { id: overrides.projectId ?? 42 },
    object_attributes: {
      iid: 7,
      action: overrides.action ?? 'close',
      state: overrides.state ?? 'closed',
    },
    changes: overrides.changes ?? { state_id: { previous: 1, current: 2 } },
  }
}

function issueResponse(
  body: Record<string, unknown> = {
    state: 'closed',
    updated_at: '2026-11-24T10:00:00.000+01:00',
    project_id: 42,
  }
) {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  gitlabFetch.mockReset()
  gitlabFetch.mockResolvedValue(issueResponse())
})

describe('gitlabInboundHandler.parseStatusChange', () => {
  it('declares automatic status handling', () => {
    expect(gitlabInboundHandler.statusMode).toBe('automatic')
  })

  it('reads the issue back from the configured project and applies its state', async () => {
    expect(await parse(issueEvent())).toEqual({
      externalId: '7',
      externalStatus: 'Closed',
      eventType: 'issue.state_changed',
      destinationId: '42',
      occurredAt: '2026-11-24T09:00:00.000Z',
    })
    expect(gitlabFetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/projects/42/issues/7', {
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('reads from the connected self-hosted instance', async () => {
    await parse(issueEvent(), { ...config, instanceUrl: 'https://gitlab.example.com/' })
    expect(gitlabFetch).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/projects/42/issues/7',
      expect.anything()
    )
  })

  it('uses the read-back state, not the unsigned body', async () => {
    gitlabFetch.mockResolvedValue(
      issueResponse({ state: 'opened', updated_at: '2026-11-24T09:00:00Z', project_id: 42 })
    )
    expect(await parse(issueEvent())).toMatchObject({ externalStatus: 'Open' })
  })

  it('parses a reopen event', async () => {
    gitlabFetch.mockResolvedValue(
      issueResponse({ state: 'opened', updated_at: '2026-11-24T09:00:00Z', project_id: 42 })
    )
    expect(await parse(issueEvent({ action: 'reopen', state: 'opened' }))).toMatchObject({
      externalStatus: 'Open',
    })
  })

  it('parses an update that changes the state', async () => {
    expect(await parse(issueEvent({ action: 'update' }))).toMatchObject({
      externalStatus: 'Closed',
      destinationId: '42',
    })
  })

  it('ignores an issue that no longer exists in the project', async () => {
    gitlabFetch.mockResolvedValue(new Response('{}', { status: 404 }))
    expect(await parse(issueEvent())).toBeNull()
  })

  it('throws on other read failures so the receipt is retried', async () => {
    gitlabFetch.mockResolvedValue(new Response('{}', { status: 500 }))
    await expect(parse(issueEvent())).rejects.toThrow()
  })

  it('ignores a read-back from a different project', async () => {
    gitlabFetch.mockResolvedValue(
      issueResponse({ state: 'closed', updated_at: '2026-11-24T09:00:00Z', project_id: 99 })
    )
    expect(await parse(issueEvent())).toBeNull()
  })

  it('ignores an unknown read-back state', async () => {
    gitlabFetch.mockResolvedValue(
      issueResponse({ state: 'locked', updated_at: '2026-11-24T09:00:00Z', project_id: 42 })
    )
    expect(await parse(issueEvent())).toBeNull()
  })

  it('falls back to review without an access token', async () => {
    expect(await parse(issueEvent(), config, {})).toEqual({
      externalId: '7',
      externalStatus: 'Closed',
      eventType: 'issue.state_changed',
    })
    expect(gitlabFetch).not.toHaveBeenCalled()
  })

  it('ignores an update that does not change the state', async () => {
    const payload = issueEvent({
      action: 'update',
      state: 'opened',
      changes: { title: { previous: 'a', current: 'b' } },
    })
    expect(await parse(payload)).toBeNull()
    expect(gitlabFetch).not.toHaveBeenCalled()
  })

  it('ignores an event from another project, whose issue numbers can collide', async () => {
    expect(await parse(issueEvent({ projectId: 99 }))).toBeNull()
    expect(gitlabFetch).not.toHaveBeenCalled()
  })

  it('ignores an event without a project when a project is configured', async () => {
    const payload = { ...issueEvent(), project: undefined }
    expect(await parse(payload)).toBeNull()
  })

  it('ignores non-issue events', async () => {
    expect(await parse({ ...issueEvent(), object_kind: 'merge_request' })).toBeNull()
  })
})
