import { describe, expect, it, vi, afterEach } from 'vitest'
import { githubWebhookEvents } from '@/lib/server/domains/channel-accounts/github-connection'
import { registerGitHubWebhook, patchGitHubWebhook } from '../webhook-registration'

describe('githubWebhookEvents', () => {
  it('adds issue_comment only when the inbox channel is live', () => {
    expect(githubWebhookEvents(false)).toEqual(['issues'])
    expect(githubWebhookEvents(true)).toEqual(['issues', 'issue_comment'])
  })
})

describe('github webhook registration events', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registerGitHubWebhook posts the events it is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 99 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await registerGitHubWebhook(
      'tok',
      'acme/api',
      'https://app.example/api/integrations/github/webhook',
      'secret',
      ['issues', 'issue_comment']
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.events).toEqual(['issues', 'issue_comment'])
  })

  it('patchGitHubWebhook PATCHes events onto an existing hook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    await patchGitHubWebhook(
      'tok',
      'acme/api',
      '12',
      ['issues'],
      'https://app.example/api/integrations/github/webhook',
      'secret'
    )

    expect(fetchMock.mock.calls[0][0]).toContain('/hooks/12')
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.events).toEqual(['issues'])
  })
})
