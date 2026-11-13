import { describe, expect, it, vi, afterEach } from 'vitest'
import { githubWebhookEvents } from '@/lib/server/domains/channel-accounts/github-connection'
import { registerGitHubWebhook, patchGitHubWebhook } from '../webhook-registration'

describe('githubWebhookEvents', () => {
  it('adds issue_comment only for a repository bringing its issues into a live inbox', () => {
    const inbox = { inboundMode: 'conversations' }
    expect(githubWebhookEvents(inbox, { inboxLive: true })).toEqual(['issues', 'issue_comment'])
    expect(githubWebhookEvents(inbox, { inboxLive: false })).toEqual(['issues'])
    expect(githubWebhookEvents({ inboundMode: 'off' }, { inboxLive: true })).toEqual(['issues'])
    expect(githubWebhookEvents({}, { inboxLive: true })).toEqual(['issues'])
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
