import { beforeEach, describe, expect, it, vi } from 'vitest'

const processEventMock = vi.fn()

vi.mock('../process', () => ({
  processEvent: (...args: unknown[]) => processEventMock(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  processEventMock.mockReset()
})

const actor = { type: 'service' as const, displayName: 'test' }
const ticket = {
  id: 'ticket_thread_1',
  subject: 'thread content',
  statusId: null,
  statusCategory: 'open',
  priority: 'normal',
  channel: 'email',
  visibilityScope: 'team',
  inboxId: null,
  primaryTeamId: null,
  assigneePrincipalId: null,
  assigneeTeamId: null,
  requesterPrincipalId: 'principal_requester',
  requesterContactId: null,
  organizationId: null,
}

describe('ticket thread dispatch snapshots', () => {
  it('includes full body text for added thread events', async () => {
    const { dispatchTicketThreadAdded } = await import('../dispatch')
    await dispatchTicketThreadAdded(actor, ticket, 'thread_1', 'public', null, {
      bodyTextPreview: 'Preview text',
      bodyText: 'Full reply body with enough context for the email recipient.',
      bodyTextTruncated: false,
      authorPrincipalId: 'principal_requester',
      isFromRequester: true,
      createdAt: '2026-06-16T10:10:00.000Z',
    })

    const event = processEventMock.mock.calls[0][0] as any
    expect(event.type).toBe('ticket.thread_added')
    expect(event.data.thread.bodyText).toBe(
      'Full reply body with enough context for the email recipient.'
    )
    expect(event.data.thread.bodyTextPreview).toBe('Preview text')
  })

  it('includes the last known body text for deleted thread events', async () => {
    const { dispatchTicketThreadDeleted } = await import('../dispatch')
    await dispatchTicketThreadDeleted(
      actor,
      ticket,
      'thread_1',
      'public',
      null,
      'principal_agent',
      {
        bodyTextPreview: 'Removed preview',
        bodyText: 'Removed reply body that should still be understandable in email.',
        bodyTextTruncated: false,
        authorPrincipalId: 'principal_requester',
        isFromRequester: true,
        createdAt: '2026-06-16T10:10:00.000Z',
      }
    )

    const event = processEventMock.mock.calls[0][0] as any
    expect(event.type).toBe('ticket.thread_deleted')
    expect(event.data.thread.bodyText).toBe(
      'Removed reply body that should still be understandable in email.'
    )
  })
})
