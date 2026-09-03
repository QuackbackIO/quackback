import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData, PostCreatedEvent } from '@/lib/server/events/types'
import { gitlabHook } from '@/integrations/gitlab/server/hook'

// GitLab requests go through the SSRF guard; route them to the stubbed global
// fetch so the assertions below see the same calls.
vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}))

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

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
        voteCount: 3,
      },
    },
  }
}

const target = { channelId: '42' }

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('gitlabHook', () => {
  it('creates issues on gitlab.com when instanceUrl is omitted', async () => {
    const fetchMock = mockFetch(201, { iid: 9, web_url: 'https://gitlab.com/acme/app/-/issues/9' })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(makePostCreatedEvent(), target, {
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
    })

    expect(result).toEqual({
      success: true,
      externalId: '9',
      externalUrl: 'https://gitlab.com/acme/app/-/issues/9',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/42/issues',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('creates issues on a custom HTTPS instance', async () => {
    const fetchMock = mockFetch(201, {
      iid: 3,
      web_url: 'https://gitlab.example.com/acme/app/-/issues/3',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gitlabHook.run(makePostCreatedEvent(), target, {
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
      instanceUrl: 'https://gitlab.example.com/',
    })

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/projects/42/issues',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('tests the connection against the configured instance', async () => {
    const fetchMock = mockFetch(200, { username: 'ada' })
    vi.stubGlobal('fetch', fetchMock)

    if (!gitlabHook.testConnection) throw new Error('gitlabHook.testConnection missing')
    const result = await gitlabHook.testConnection({
      accessToken: 'tok',
      rootUrl: 'https://app.example.com',
      instanceUrl: 'https://gitlab.example.com',
    })

    expect(result).toEqual({ ok: true, error: undefined })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/user',
      expect.any(Object)
    )
  })

  it('skips non post.created events', async () => {
    const result = await gitlabHook.run(
      { type: 'post.status_changed' } as unknown as EventData,
      target,
      { accessToken: 'tok', rootUrl: 'https://app.example.com' }
    )
    expect(result).toEqual({ success: true })
  })
})
