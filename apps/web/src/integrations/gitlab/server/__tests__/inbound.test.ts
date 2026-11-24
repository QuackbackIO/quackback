/**
 * Tests for GitLab inbound webhook handler.
 */

import { describe, it, expect } from 'vitest'
import { gitlabInboundHandler } from '@/integrations/gitlab/server/inbound'

const config = { channelId: '42' }

const parse = (payload: unknown, cfg: Record<string, unknown> = config) =>
  gitlabInboundHandler.parseStatusChange(JSON.stringify(payload), cfg, {})

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

describe('gitlabInboundHandler.parseStatusChange', () => {
  it('declares review status handling', () => {
    expect(gitlabInboundHandler.statusMode).toBe('review')
  })

  it('parses a close event from the configured project', async () => {
    expect(await parse(issueEvent())).toEqual({
      externalId: '7',
      externalStatus: 'Closed',
      eventType: 'issue.state_changed',
    })
  })

  it('parses a reopen event', async () => {
    expect(await parse(issueEvent({ action: 'reopen', state: 'opened' }))).toMatchObject({
      externalStatus: 'Open',
    })
  })

  it('parses an update that changes the state', async () => {
    expect(await parse(issueEvent({ action: 'update' }))).toMatchObject({
      externalStatus: 'Closed',
    })
  })

  it('ignores an update that does not change the state', async () => {
    const payload = issueEvent({
      action: 'update',
      state: 'opened',
      changes: { title: { previous: 'a', current: 'b' } },
    })
    expect(await parse(payload)).toBeNull()
  })

  it('ignores an event from another project, whose issue numbers can collide', async () => {
    expect(await parse(issueEvent({ projectId: 99 }))).toBeNull()
  })

  it('ignores an event without a project when a project is configured', async () => {
    const payload = { ...issueEvent(), project: undefined }
    expect(await parse(payload)).toBeNull()
  })

  it('ignores non-issue events', async () => {
    expect(await parse({ ...issueEvent(), object_kind: 'merge_request' })).toBeNull()
  })
})
