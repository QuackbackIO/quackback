/**
 * Reading a comment change from a GitHub `issue_comment` delivery and from the
 * issue's comment list: the comment with its author, versions and URL, the
 * repository by name and id, and the thread key of the issue's Inbox
 * conversation. Our own account's comments are flagged, a Quackback marker
 * is noticed and a reply's marker read. `issues` deliveries, other actions
 * and pull-request comments report nothing. An issue body names a ticket by
 * our marker or by a link into this workspace's admin.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { githubInboundHandler } from '../inbound'
import {
  githubIssueComments,
  parseTicketCommentMarker,
  ticketCommentMarker,
} from '../ticket-comment'
import { ticketIssueMarker, ticketReferenceIn } from '../ticket-issue'

const config = { username: 'acme-bot' }
const comment = (over: Record<string, unknown> = {}) => ({
  id: 555,
  body: 'Reproduced on **main**.',
  html_url: 'https://github.com/acme/api/issues/7#issuecomment-555',
  user: { id: 42, login: 'jane-gh' },
  created_at: '2026-10-14T10:00:00Z',
  updated_at: '2026-10-14T10:05:00Z',
  ...over,
})
const delivery = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    action: 'created',
    comment: comment(),
    sender: { login: 'jane-gh' },
    repository: { full_name: 'acme/api', id: 1 },
    issue: { number: 7, html_url: 'https://github.com/acme/api/issues/7' },
    ...over,
  })

describe('GitHub comment changes', () => {
  const parse = (body: string) => githubInboundHandler.parseCommentChange!(body, config)

  it('reads a created, edited or deleted comment', () => {
    expect(parse(delivery())).toEqual({
      destination: { externalId: 'acme/api', externalKey: '1' },
      externalId: '7',
      externalDisplayId: 'acme/api#7',
      externalUrl: 'https://github.com/acme/api/issues/7',
      threadKey: 'acme/api#7',
      action: 'created',
      comment: {
        externalId: '555',
        externalUrl: 'https://github.com/acme/api/issues/7#issuecomment-555',
        body: 'Reproduced on **main**.',
        author: { externalUserId: '42', login: 'jane-gh' },
        createdAt: '2026-10-14T10:00:00Z',
        updatedAt: '2026-10-14T10:05:00Z',
        byConnection: false,
        marked: false,
        mirrorOf: null,
      },
    })
    expect(parse(delivery({ action: 'edited' }))?.action).toBe('edited')
    expect(parse(delivery({ action: 'deleted' }))?.action).toBe('deleted')
  })

  it("flags our own account's comments and reads a reply's marker", () => {
    expect(parse(delivery({ comment: comment({ user: { login: 'ACME-BOT' } }) }))).toMatchObject({
      comment: { byConnection: true, marked: false, mirrorOf: null },
    })
    const body = `_Quackback reply by Jane_\n\nFixed.\n\n${ticketCommentMarker('conversation_msg_1', 'integration_9')}`
    expect(parse(delivery({ comment: comment({ body }) }))).toMatchObject({
      comment: {
        marked: true,
        mirrorOf: { messageId: 'conversation_msg_1', integrationId: 'integration_9' },
      },
    })
    expect(
      parse(
        delivery({ comment: comment({ body: 'x <!-- quackback:ticket-issue ticketId=t -->' }) })
      )
    ).toMatchObject({ comment: { marked: true, mirrorOf: null } })
  })

  it('reports nothing for an issues delivery, another action, a pull request or a malformed body', () => {
    expect(parse(delivery({ comment: undefined, action: 'edited' }))).toBeNull()
    expect(parse(delivery({ action: 'pinned' }))).toBeNull()
    expect(parse(delivery({ issue: { number: 7, pull_request: { url: 'https://x' } } }))).toBeNull()
    expect(parse(delivery({ comment: comment({ user: null }) }))).toBeNull()
    expect(parse('{not json')).toBeNull()
  })
})

describe('parseTicketCommentMarker', () => {
  it('reads back the marker a reply is posted with', () => {
    expect(parseTicketCommentMarker(`body\n\n${ticketCommentMarker('m1', 'i1')}`)).toEqual({
      messageId: 'm1',
      integrationId: 'i1',
    })
    expect(parseTicketCommentMarker('no marker')).toBeNull()
    expect(parseTicketCommentMarker(null)).toBeNull()
  })
})

describe('githubIssueComments.list', () => {
  afterEach(() => vi.restoreAllMocks())

  it('pages through the comments since a time, up to the limit', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => comment({ id: i + 1 })),
      [comment({ id: 101 }), comment({ id: 102, user: { login: 'acme-bot' } })],
    ]
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        Response.json(pages[Number(new URL(String(input)).searchParams.get('page')) - 1] ?? [])
      )
    const list = await githubIssueComments.list({
      auth: { accessToken: 'tok', channelId: 'acme/api', username: 'acme-bot' },
      issueId: '7',
      since: '2026-10-01T00:00:00.000Z',
      limit: 300,
    })
    expect(list).toHaveLength(102)
    expect(list[101]).toMatchObject({ externalId: '102', byConnection: true })
    const first = new URL(String(fetchMock.mock.calls[0][0]))
    expect(first.pathname).toBe('/repos/acme/api/issues/7/comments')
    expect(first.searchParams.get('since')).toBe('2026-10-01T00:00:00.000Z')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    const capped = await githubIssueComments.list({
      auth: { accessToken: 'tok', channelId: 'acme/api' },
      issueId: '7',
      since: '2026-10-01T00:00:00.000Z',
      limit: 50,
    })
    expect(capped).toHaveLength(50)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('names the Inbox thread of an issue', () => {
    expect(githubIssueComments.threadKey!({ channelId: 'acme/api' }, '7')).toBe('acme/api#7')
  })
})

describe('ticket references in an issue body', () => {
  const ticketId = 'ticket_01k7b2q3r4s5t6v7w8x9y0z1a2'
  const root = 'https://help.acme.test'

  it('reads our marker, with the connection it names', () => {
    expect(
      ticketReferenceIn(`Steps.\n\n${ticketIssueMarker(ticketId, 'integration_9')}`, root)
    ).toEqual({ ticketId, integrationId: 'integration_9' })
  })

  it('reads a link to the ticket in this workspace, and nothing elsewhere', () => {
    expect(
      ticketReferenceIn(`[View in Quackback](${root}/admin/inbox?i=${ticketId})`, root)
    ).toEqual({
      ticketId,
    })
    expect(ticketReferenceIn(`${root}/admin/tickets/${ticketId}`, root)).toEqual({ ticketId })
    expect(ticketReferenceIn(`https://other.test/admin/inbox?i=${ticketId}`, root)).toBeNull()
    expect(ticketReferenceIn(`${root}/portal/tickets/${ticketId}`, root)).toBeNull()
    expect(ticketReferenceIn(`${root}/admin/inbox?i=ticket_short`, root)).toBeNull()
    expect(ticketReferenceIn(null, root)).toBeNull()
  })

  it('is read from issues and issue_comment deliveries, never a pull request', () => {
    const parse = githubInboundHandler.parseTicketReference!
    const body = (issue: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        action: 'edited',
        repository: { full_name: 'acme/api', id: 1 },
        issue: { number: 12, html_url: 'https://github.com/acme/api/issues/12', ...issue },
        ...extra,
      })
    const marked = { body: ticketIssueMarker(ticketId, 'integration_9') }
    expect(parse(body(marked))).toEqual({
      destination: { externalId: 'acme/api', externalKey: '1' },
      externalId: '12',
      externalDisplayId: 'acme/api#12',
      externalUrl: 'https://github.com/acme/api/issues/12',
      ticketId,
      integrationId: 'integration_9',
    })
    expect(parse(body(marked, { action: 'created', comment: comment() }))?.ticketId).toBe(ticketId)
    expect(parse(body({ ...marked, pull_request: {} }))).toBeNull()
    expect(parse(body({ body: 'No reference.' }))).toBeNull()
  })
})
