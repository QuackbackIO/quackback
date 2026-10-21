/**
 * A ticket reply as a GitHub comment: a header naming the teammate who wrote
 * it, or nobody for the requester; the reply with app-relative links made
 * absolute; the reply's own files (images inline); the hidden marker the
 * inbox recognises; and a body under GitHub's size limit however long the
 * reply. Then the three calls that write the comment, how a rejection carries
 * its status to the ledger, and a delete of a comment already gone.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/server/config', () => ({ getBaseUrl: () => 'https://help.acme.test' }))

import {
  buildGitHubTicketComment,
  githubIssueComments,
  GITHUB_COMMENT_BODY_LIMIT,
} from '../ticket-comment'
import { hasQuackbackMarker } from '@/lib/server/domains/conversation/conversation.github-inbound-store'
import { withSyncTransport } from '@/lib/server/integrations/sync/transport'
import type { TicketReplySource } from '@/lib/server/integrations/types'

const reply = (over: Partial<TicketReplySource> = {}): TicketReplySource => ({
  messageId: 'conversation_msg_01',
  ticketId: 'ticket_01',
  senderType: 'agent',
  authorName: 'Jane Doe',
  markdown: 'Fixed in the next release. See ![shot](/api/files/abc.png)',
  attachments: [],
  ...over,
})

describe('buildGitHubTicketComment', () => {
  it("names the teammate, keeps the reply and ends with the reply's marker", () => {
    const body = buildGitHubTicketComment(reply(), { integrationId: 'integration_9' })
    expect(body.split('\n')[0]).toBe('_Quackback reply by Jane Doe_')
    expect(body).toContain(
      'Fixed in the next release. See ![shot](https://help.acme.test/api/files/abc.png)'
    )
    expect(body.trimEnd()).toMatch(
      /<!-- quackback:ticket-comment messageId=conversation_msg_01 integrationId=integration_9 -->$/
    )
    // The inbox's echo guard recognises it when GitHub sends it back.
    expect(hasQuackbackMarker(body)).toBe(true)
  })

  it('names nobody for a requester reply, nor a teammate without a name', () => {
    const customer = buildGitHubTicketComment(
      reply({ senderType: 'visitor', authorName: 'Pat Customer' }),
      { integrationId: 'i' }
    )
    expect(customer.split('\n')[0]).toBe('_Customer reply from Quackback_')
    expect(customer).not.toContain('Pat')
    expect(customer).not.toMatch(/@/)
    const nameless = buildGitHubTicketComment(reply({ authorName: null }), { integrationId: 'i' })
    expect(nameless.split('\n')[0]).toBe('_Quackback reply_')
  })

  it('keeps a display name from breaking out of the header', () => {
    const body = buildGitHubTicketComment(reply({ authorName: 'Jane_[x](y)\n*Doe*' }), {
      integrationId: 'i',
    })
    expect(body.split('\n')[0]).toBe('_Quackback reply by Jane\\_\\[x\\](y) \\*Doe\\*_')
  })

  it("lists the reply's files, images inline and other files linked", () => {
    const body = buildGitHubTicketComment(
      reply({
        attachments: [
          { name: 'screen.png', url: '/api/files/screen.png', contentType: 'image/png' },
          { name: 'log [1].txt', url: 'https://cdn.acme.test/log.txt', contentType: 'text/plain' },
        ],
      }),
      { integrationId: 'i' }
    )
    expect(body).toContain(
      [
        '### Attachments',
        '',
        '![screen.png](https://help.acme.test/api/files/screen.png)',
        '[log  1 .txt](https://cdn.acme.test/log.txt)',
      ].join('\n')
    )
    expect(body.indexOf('### Attachments')).toBeLessThan(body.indexOf('<!-- quackback:'))
  })

  it("cuts a long reply to fit GitHub's limit and keeps the files and marker", () => {
    const body = buildGitHubTicketComment(
      reply({
        markdown: 'word '.repeat(20_000),
        attachments: [{ name: 'a.png', url: '/api/files/a.png', contentType: 'image/png' }],
      }),
      { integrationId: 'i' }
    )
    expect(body.length).toBeLessThanOrEqual(GITHUB_COMMENT_BODY_LIMIT)
    expect(body).toContain('...')
    expect(body).toContain('![a.png](https://help.acme.test/api/files/a.png)')
    expect(body).toContain('<!-- quackback:ticket-comment messageId=conversation_msg_01')
  })
})

describe('githubIssueComments', () => {
  const auth = { accessToken: 'tok', channelId: 'acme/api' }
  afterEach(() => vi.restoreAllMocks())

  it('posts, rewrites and deletes the comment through the repository', async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return Response.json({
        id: 991,
        html_url: 'https://github.com/acme/api/issues/7#issuecomment-991',
        updated_at: '2026-10-14T10:00:00Z',
      })
    })
    expect(await githubIssueComments.create({ auth, issueId: '7', body: 'hi' })).toEqual({
      externalId: '991',
      externalUrl: 'https://github.com/acme/api/issues/7#issuecomment-991',
      version: '2026-10-14T10:00:00Z',
    })
    await githubIssueComments.update({ auth, commentId: '991', body: 'edited' })
    await githubIssueComments.delete({ auth, commentId: '991' })
    expect(calls).toEqual([
      {
        url: 'https://api.github.com/repos/acme/api/issues/7/comments',
        method: 'POST',
        body: { body: 'hi' },
      },
      {
        url: 'https://api.github.com/repos/acme/api/issues/comments/991',
        method: 'PATCH',
        body: { body: 'edited' },
      },
      {
        url: 'https://api.github.com/repos/acme/api/issues/comments/991',
        method: 'DELETE',
        body: undefined,
      },
    ])
  })

  it('treats a comment already deleted on GitHub as deleted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }))
    const outcome = await withSyncTransport(async () => {
      await githubIssueComments.delete({ auth, commentId: '991' })
      return { state: 'succeeded' }
    })
    expect(outcome).toEqual({ state: 'succeeded' })
  })

  it('reports a comment deleted on GitHub as gone when rewriting it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }))
    let rewritten: unknown
    const outcome = await withSyncTransport(async () => {
      rewritten = await githubIssueComments.update({ auth, commentId: '991', body: 'edited' })
      return { state: 'succeeded' }
    })
    expect(rewritten).toBeNull()
    expect(outcome).toEqual({ state: 'succeeded' })
  })

  it.each([
    [401, { state: 'auth_required', errorCode: 'authentication' }],
    [404, { state: 'failed', errorCode: 'provider_failed' }],
    [422, { state: 'failed', errorCode: 'provider_failed' }],
    [429, { state: 'retry_wait', errorCode: 'unavailable', retryAfterMs: 60_000 }],
    [502, { state: 'uncertain', errorCode: 'outcome_unknown' }],
  ])('reports a %i to the ledger by its status', async (status, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status, headers: status === 429 ? { 'retry-after': '60' } : {} })
    )
    const outcome = await withSyncTransport(async () => {
      await githubIssueComments.create({ auth, issueId: '7', body: 'hi' })
      return { state: 'succeeded' }
    })
    expect(outcome).toEqual(expected)
  })

  it('refuses a repository or id the API path cannot carry, without a request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(
      githubIssueComments.create({
        auth: { ...auth, channelId: 'acme/api/../x' },
        issueId: '7',
        body: 'hi',
      })
    ).rejects.toThrow('No repository configured')
    await expect(githubIssueComments.delete({ auth, commentId: '1/../2' })).rejects.toThrow(
      'Invalid comment id'
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
