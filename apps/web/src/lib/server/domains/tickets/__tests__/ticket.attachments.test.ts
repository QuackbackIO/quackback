/**
 * Phase 4: webhook dispatch from ticket attachments.
 *
 * Verifies that `attachToThread` and `removeAttachment` fire the new
 * `ticket.attachment_added` / `ticket.attachment_removed` dispatchers, that
 * the attachment payload carries the expected metadata, and that a failing
 * dispatcher is swallowed (warn-only) so the attachment write itself stays
 * the source of truth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const threadFindFirstMock = vi.fn()
const attachmentFindFirstMock = vi.fn()
const ticketFindFirstMock = vi.fn()
const insertReturningMock = vi.fn()
const deleteWhereMock = vi.fn()

const dispatchTicketAttachmentAddedMock = vi.fn()
const dispatchTicketAttachmentRemovedMock = vi.fn()
const dispatchTicketThreadUpdatedMock = vi.fn()
const buildEventActorMock = vi.fn((input: { principalId: string }) => ({
  type: 'user' as const,
  principalId: input.principalId,
  displayName: 'ticket-system',
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketThreads: { findFirst: threadFindFirstMock },
      ticketAttachments: { findFirst: attachmentFindFirstMock },
      tickets: { findFirst: ticketFindFirstMock },
    },
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      returning: insertReturningMock,
    })),
    delete: vi.fn(() => ({ where: deleteWhereMock.mockResolvedValue(undefined) })),
    select: vi.fn(),
  },
  eq: vi.fn(),
  ticketAttachments: { _name: 'ticket_attachments' },
  ticketThreads: { _name: 'ticket_threads' },
  tickets: { _name: 'tickets' },
}))

vi.mock('../../audit', () => ({ recordEvent: vi.fn() }))
vi.mock('../ticket.service', () => ({
  bumpLastActivity: vi.fn(),
  writeActivity: vi.fn(),
}))
vi.mock('@/lib/shared/errors', () => {
  class E extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  }
  return { ConflictError: E, NotFoundError: E, ValidationError: E }
})

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchTicketAttachmentAdded: (...a: unknown[]) => dispatchTicketAttachmentAddedMock(...a),
  dispatchTicketAttachmentRemoved: (...a: unknown[]) => dispatchTicketAttachmentRemovedMock(...a),
  dispatchTicketThreadUpdated: (...a: unknown[]) => dispatchTicketThreadUpdatedMock(...a),
  buildEventActor: (...a: unknown[]) => buildEventActorMock(...(a as [{ principalId: string }])),
}))

beforeEach(() => {
  vi.clearAllMocks()
  threadFindFirstMock.mockReset()
  attachmentFindFirstMock.mockReset()
  ticketFindFirstMock.mockReset()
  insertReturningMock.mockReset()
  deleteWhereMock.mockReset()
  dispatchTicketAttachmentAddedMock.mockReset()
  dispatchTicketAttachmentRemovedMock.mockReset()
  dispatchTicketThreadUpdatedMock.mockReset()
  ticketFindFirstMock.mockResolvedValue({ id: 'ticket_1', inboxId: 'inbox_1' })
})

const baseInput = {
  threadId: 'thread_1' as never,
  uploadedByPrincipalId: 'user_a' as never,
  filename: 'screenshot.png',
  mimeType: 'image/png',
  sizeBytes: 12345,
  storageKey: 'uploads/abc.png',
  publicUrl: 'https://cdn.example.test/abc.png',
}

describe('attachToThread → dispatchTicketAttachmentAdded', () => {
  it('fires dispatcher with full attachment metadata', async () => {
    threadFindFirstMock.mockResolvedValueOnce({
      id: 'thread_1',
      ticketId: 'ticket_1',
      deletedAt: null,
      audience: 'public',
      sharedWithTeamId: null,
      bodyText: 'Initial body',
      principalId: 'user_a',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      editedAt: null,
    })
    insertReturningMock.mockResolvedValueOnce([{ id: 'att_1', threadId: 'thread_1' }])
    const { attachToThread } = await import('../ticket.attachments')
    await attachToThread(baseInput)
    expect(dispatchTicketAttachmentAddedMock).toHaveBeenCalledTimes(1)
    const [, ticketPayload, payload] = dispatchTicketAttachmentAddedMock.mock.calls[0]
    expect(ticketPayload).toEqual({ id: 'ticket_1', inboxId: 'inbox_1' })
    expect(payload).toEqual({
      id: 'att_1',
      threadId: 'thread_1',
      filename: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 12345,
      uploadedByPrincipalId: 'user_a',
      publicUrl: 'https://cdn.example.test/abc.png',
    })
    expect(dispatchTicketThreadUpdatedMock).toHaveBeenCalledTimes(1)
  })

  it('swallows dispatcher rejection (warn only) and still returns the attachment', async () => {
    threadFindFirstMock.mockResolvedValueOnce({
      id: 'thread_1',
      ticketId: 'ticket_1',
      deletedAt: null,
      audience: 'public',
      sharedWithTeamId: null,
      bodyText: 'Initial body',
      principalId: 'user_a',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      editedAt: null,
    })
    insertReturningMock.mockResolvedValueOnce([{ id: 'att_2' }])
    dispatchTicketAttachmentAddedMock.mockRejectedValueOnce(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { attachToThread } = await import('../ticket.attachments')
    const created = await attachToThread(baseInput)
    expect(created.id).toBe('att_2')
    expect(warnSpy).toHaveBeenCalled()
    expect(dispatchTicketThreadUpdatedMock).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })
})

describe('removeAttachment → dispatchTicketAttachmentRemoved', () => {
  it('fires dispatcher with attachment id, threadId, filename and remover principal', async () => {
    attachmentFindFirstMock.mockResolvedValueOnce({
      id: 'att_3',
      threadId: 'thread_1',
      filename: 'logs.txt',
    })
    threadFindFirstMock.mockResolvedValueOnce({
      id: 'thread_1',
      ticketId: 'ticket_1',
      audience: 'public',
      sharedWithTeamId: null,
      bodyText: 'Updated body',
      principalId: 'user_a',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      editedAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    const { removeAttachment } = await import('../ticket.attachments')
    await removeAttachment('att_3' as never, 'user_b' as never)
    expect(dispatchTicketAttachmentRemovedMock).toHaveBeenCalledTimes(1)
    const [, ticketPayload, attachment, removedBy] =
      dispatchTicketAttachmentRemovedMock.mock.calls[0]
    expect(ticketPayload).toEqual({ id: 'ticket_1', inboxId: 'inbox_1' })
    expect(attachment).toEqual({ id: 'att_3', threadId: 'thread_1', filename: 'logs.txt' })
    expect(removedBy).toBe('user_b')
    expect(dispatchTicketThreadUpdatedMock).toHaveBeenCalledTimes(1)
  })

  it('swallows dispatcher rejection on remove (warn only)', async () => {
    attachmentFindFirstMock.mockResolvedValueOnce({
      id: 'att_4',
      threadId: 'thread_1',
      filename: 'logs.txt',
    })
    threadFindFirstMock.mockResolvedValueOnce({
      id: 'thread_1',
      ticketId: 'ticket_1',
      audience: 'public',
      sharedWithTeamId: null,
      bodyText: 'Updated body',
      principalId: 'user_a',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      editedAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    dispatchTicketAttachmentRemovedMock.mockRejectedValueOnce(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { removeAttachment } = await import('../ticket.attachments')
    await expect(removeAttachment('att_4' as never, null)).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    expect(dispatchTicketThreadUpdatedMock).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })
})
