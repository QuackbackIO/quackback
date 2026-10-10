import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData, PostCreatedEvent } from '@/lib/server/events/types'
import { jiraHook, parseJiraChannelId } from '../hook'

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
  vi.restoreAllMocks()
})

describe('parseJiraChannelId', () => {
  it('splits the settings composite', () => {
    expect(parseJiraChannelId('10000:10001')).toEqual({
      projectId: '10000',
      issueTypeId: '10001',
    })
  })

  it('accepts a bare project id', () => {
    expect(parseJiraChannelId('10000')).toEqual({ projectId: '10000' })
  })
})

describe('jiraHook', () => {
  it('refuses to call Jira when cloudId is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await jiraHook.run(
      makePostCreatedEvent(),
      { channelId: '10000:10001' },
      { accessToken: 'tok', rootUrl: 'https://app.example.com' }
    )

    expect(result).toEqual({ state: 'failed', errorCode: 'provider_failed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to the cloud id and splits a composite channel id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ key: 'PROJ-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await jiraHook.run(
      makePostCreatedEvent(),
      { channelId: '10000:10001' },
      {
        accessToken: 'tok',
        cloudId: 'cloud-1',
        rootUrl: 'https://app.example.com',
      }
    )

    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') throw new Error('Expected successful delivery')
    expect(result.result?.externalId).toBe('PROJ-1')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue'
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.fields.project).toEqual({ id: '10000' })
    expect(body.fields.issuetype).toEqual({ id: '10001' })
  })

  it('prefers issueTypeId from config over the channel composite', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ key: 'PROJ-2' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await jiraHook.run(
      makePostCreatedEvent(),
      { channelId: '10000:10001' },
      {
        accessToken: 'tok',
        cloudId: 'cloud-1',
        issueTypeId: '999',
        rootUrl: 'https://app.example.com',
      }
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.fields.issuetype).toEqual({ id: '999' })
  })

  it('maps HTTP 401 to reconnect only when cloudId and token are present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })))

    const result = await jiraHook.run(
      makePostCreatedEvent(),
      { channelId: '10000:10001' },
      { accessToken: 'tok', cloudId: 'cloud-1', rootUrl: 'https://app.example.com' }
    )

    expect(result).toEqual({ state: 'auth_required', errorCode: 'authentication' })
  })

  it('refuses to call Jira when the access token is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await jiraHook.run(
      makePostCreatedEvent(),
      { channelId: '10000:10001' },
      { cloudId: 'cloud-1', rootUrl: 'https://app.example.com' }
    )

    expect(result).toEqual({ state: 'failed', errorCode: 'provider_failed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips non post.created events', async () => {
    const event = { type: 'post.status_changed' } as unknown as EventData
    expect(await jiraHook.run(event, { channelId: '10000' }, { cloudId: 'c' })).toEqual({
      state: 'succeeded',
    })
  })
})
