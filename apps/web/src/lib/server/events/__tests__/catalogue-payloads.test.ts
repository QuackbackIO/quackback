import { describe, it, expect } from 'vitest'
import { EVENT_TYPES } from '../types'
import { P } from '../catalogue/payloads'
import { getEventDefinition } from '../catalogue'

/**
 * WO-5 — the catalogue payloads are precise (not the WO-2 skeleton). Every
 * EVENT_TYPES member has a hardened schema, and representative fixtures parse
 * while malformed ones are rejected.
 */
describe('catalogue payloads (WO-5)', () => {
  it('has a precise schema for every EVENT_TYPES member (nothing left on the skeleton)', () => {
    const hardened = new Set(Object.keys(P))
    const missing = EVENT_TYPES.filter((t) => !hardened.has(t))
    expect(missing).toEqual([])
  })

  it('post.status_changed validates its fixture and rejects a bad one', () => {
    const def = getEventDefinition('post.status_changed')!
    const good = {
      post: { id: 'post_x', title: 'T', boardId: 'board_x', boardSlug: 'b' },
      previousStatus: 'open',
      newStatus: 'done',
    }
    expect(def.payload.parse(good)).toMatchObject({ newStatus: 'done' })
    expect(() => def.payload.parse({ post: { id: 'post_x' } })).toThrow()
  })

  it('ticket.replied validates attachments + senderType enum', () => {
    const def = getEventDefinition('ticket.replied')!
    const good = {
      ticket: { id: 'ticket_x', number: 12, type: 'customer', priority: 'high' },
      messageId: 'conversation_msg_x',
      content: 'hi',
      attachments: [{ name: 'a.png', url: 'https://x/a.png', contentType: 'image/png', size: 10 }],
      senderType: 'agent',
      title: 'Cannot log in',
      authorName: 'Sarah',
      requesterPrincipalId: 'principal_requester',
    }
    expect(def.payload.parse(good)).toMatchObject({ senderType: 'agent' })
    expect(() => def.payload.parse({ ...good, senderType: 'robot' })).toThrow()
  })

  it('ticket.due_changed carries the new and previous due dates, null when unset', () => {
    const def = getEventDefinition('ticket.due_changed')!
    const ticket = {
      id: 'ticket_x',
      number: 12,
      type: 'customer',
      priority: 'high',
      dueAt: '2026-10-21T21:59:00.000Z',
    }
    const set = {
      ticket,
      title: 'Cannot log in',
      dueAt: '2026-10-21T21:59:00.000Z',
      previousDueAt: null,
    }
    expect(def.payload.parse(set)).toMatchObject({ previousDueAt: null })
    const cleared = { ticket: { ...ticket, dueAt: null }, title: 'Cannot log in', dueAt: null }
    expect(() =>
      def.payload.parse({ ...cleared, previousDueAt: '2026-10-21T21:59:00.000Z' })
    ).not.toThrow()
    expect(() => def.payload.parse({ ...set, dueAt: 42 })).toThrow()
  })

  it.each(['ticket.due_soon', 'ticket.overdue'])('%s requires the due date it alerts for', (t) => {
    const def = getEventDefinition(t)!
    const good = {
      ticket: {
        id: 'ticket_x',
        number: 12,
        type: 'customer',
        priority: 'none',
        assignedPrincipalId: 'principal_agent',
        assignedTeamId: null,
        dueAt: '2026-10-21T21:59:00.000Z',
      },
      title: 'Cannot log in',
      dueAt: '2026-10-21T21:59:00.000Z',
    }
    expect(def.payload.parse(good)).toMatchObject({ dueAt: '2026-10-21T21:59:00.000Z' })
    expect(() => def.payload.parse({ ...good, dueAt: null })).toThrow()
  })

  it('the ticket ref takes a dueAt and still accepts a ref recorded without one', () => {
    const def = getEventDefinition('ticket.assigned')!
    const base = {
      assignedPrincipalId: 'principal_agent',
      previousPrincipalId: null,
      assignedTeamId: null,
      previousTeamId: null,
    }
    const ref = { id: 'ticket_x', number: 12, type: 'customer', priority: 'high' }
    expect(() => def.payload.parse({ ...base, ticket: ref })).not.toThrow()
    expect(() =>
      def.payload.parse({ ...base, ticket: { ...ref, dueAt: '2026-10-21T21:59:00.000Z' } })
    ).not.toThrow()
    expect(() => def.payload.parse({ ...base, ticket: { ...ref, dueAt: 7 } })).toThrow()
  })

  it('tolerates extra fields on a real event (loose top-level object)', () => {
    const def = getEventDefinition('conversation.created')!
    const withExtra = {
      conversation: { id: 'conversation_x', status: 'open', channel: 'email', priority: 'none' },
      subject: 'hello',
      visitorEmail: null,
      unexpectedFutureField: 42,
    }
    expect(() => def.payload.parse(withExtra)).not.toThrow()
  })
})
