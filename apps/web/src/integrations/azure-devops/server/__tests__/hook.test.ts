import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData, PostCreatedEvent } from '@/lib/server/events/types'

vi.mock('../api', () => ({
  createWorkItem: vi.fn(),
}))

import { azureDevOpsHook } from '../hook'
import { createWorkItem } from '../api'

function makePostCreatedEvent(): PostCreatedEvent {
  return {
    id: 'evt-1',
    type: 'post.created',
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1', email: 'test@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Bug report',
        content: '<p>Something broke</p>',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 0,
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('azureDevOpsHook', () => {
  it('does not treat a missing organization name as an auth failure', async () => {
    const result = await azureDevOpsHook.run(
      makePostCreatedEvent(),
      { channelId: 'Proj:Task' },
      { accessToken: 'pat', rootUrl: 'https://app.example.com' }
    )

    expect(result).toEqual({ state: 'failed', errorCode: 'provider_failed' })
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('creates a work item when organizationName is present', async () => {
    vi.mocked(createWorkItem).mockResolvedValue({
      id: 42,
      url: 'https://dev.azure.com/acme/Proj/_workitems/edit/42',
    })

    const result = await azureDevOpsHook.run(
      makePostCreatedEvent(),
      { channelId: 'Proj:Task' },
      {
        accessToken: 'pat',
        organizationName: 'acme',
        rootUrl: 'https://app.example.com',
      }
    )

    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') throw new Error('Expected successful delivery')
    expect(result.result?.externalId).toBe('42')
    expect(createWorkItem).toHaveBeenCalledWith('pat', 'acme', 'Proj', 'Task', expect.any(Object))
  })

  it('maps HTTP 401 to reconnect only when organizationName is present', async () => {
    vi.mocked(createWorkItem).mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 })
    )

    const result = await azureDevOpsHook.run(
      makePostCreatedEvent(),
      { channelId: 'Proj:Task' },
      {
        accessToken: 'pat',
        organizationName: 'acme',
        rootUrl: 'https://app.example.com',
      }
    )

    expect(result).toEqual({ state: 'auth_required', errorCode: 'authentication' })
  })

  it('skips non post.created events', async () => {
    const event = { type: 'comment.created' } as unknown as EventData
    expect(await azureDevOpsHook.run(event, { channelId: 'Proj:Task' }, {})).toEqual({
      state: 'succeeded',
    })
  })
})
