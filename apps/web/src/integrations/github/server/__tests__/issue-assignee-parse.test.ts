/**
 * Reading an assignee change from a GitHub `issues` delivery: the account
 * added or removed with its numeric id, the repository by name and id, and
 * the thread key of the issue's Inbox conversation. Other actions, pull
 * requests, a missing assignee and our own bot's changes report nothing.
 */
import { describe, expect, it } from 'vitest'
import { githubInboundHandler } from '../inbound'

const config = { username: 'acme-bot' }
const delivery = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    action: 'assigned',
    assignee: { id: 42, login: 'jane-gh' },
    sender: { login: 'maintainer' },
    repository: { full_name: 'acme/api', id: 1 },
    issue: {
      number: 7,
      html_url: 'https://github.com/acme/api/issues/7',
      updated_at: '2026-10-14T10:00:00Z',
    },
    ...over,
  })

describe('GitHub assignee changes', () => {
  const parse = (body: string) => githubInboundHandler.parseAssigneeChange!(body, config)

  it('reads an assignment and an unassignment', () => {
    expect(parse(delivery())).toEqual({
      destination: { externalId: 'acme/api', externalKey: '1' },
      externalId: '7',
      externalDisplayId: 'acme/api#7',
      externalUrl: 'https://github.com/acme/api/issues/7',
      threadKey: 'acme/api#7',
      action: 'assigned',
      assignee: { externalUserId: '42', login: 'jane-gh' },
      occurredAt: '2026-10-14T10:00:00Z',
    })
    expect(parse(delivery({ action: 'unassigned' }))?.action).toBe('unassigned')
    expect(parse(delivery({ assignee: { login: 'jane-gh' } }))?.assignee).toEqual({
      externalUserId: null,
      login: 'jane-gh',
    })
  })

  it('reports nothing for other deliveries and for our own bot', () => {
    expect(parse(delivery({ action: 'closed' }))).toBeNull()
    expect(parse(delivery({ assignee: null }))).toBeNull()
    expect(parse(delivery({ issue: { number: 7, pull_request: { url: 'x' } } }))).toBeNull()
    expect(parse(delivery({ repository: { full_name: 'nope' } }))).toBeNull()
    expect(parse(delivery({ sender: { login: 'Acme-Bot' } }))).toBeNull()
    expect(parse('not json')).toBeNull()
  })
})
