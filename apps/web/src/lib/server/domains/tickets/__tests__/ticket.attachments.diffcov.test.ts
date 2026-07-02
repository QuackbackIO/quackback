/**
 * Differential-coverage tests for ticket.attachments — attach/list/remove with
 * the validation matrix, thread-not-found guard, preview truncation,
 * from-requester detection, actor (principal vs service), event dispatch +
 * fallback thread-refresh, and the defensive try/catch swallows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  threadsFindFirst: vi.fn(),
  attachmentsFindFirst: vi.fn(),
  ticketsFindFirst: vi.fn(),
  insertReturning: vi.fn(),
  deleteWhere: vi.fn(),
  selectWhere: vi.fn(),
  recordEvent: vi.fn(),
  writeActivity: vi.fn(),
  bumpLastActivity: vi.fn(),
  buildEventActor: vi.fn((..._a: unknown[]) => ({ type: 'user', principalId: 'p1' })),
  dAdded: vi.fn(),
  dRemoved: vi.fn(),
  dThreadUpdated: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketThreads: { findFirst: m.threadsFindFirst },
      ticketAttachments: { findFirst: m.attachmentsFindFirst },
      tickets: { findFirst: m.ticketsFindFirst },
    },
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    delete: () => ({ where: (...a: unknown[]) => m.deleteWhere(...a) }),
    select: () => ({ from: () => ({ where: (...a: unknown[]) => m.selectWhere(...a) }) }),
  },
  eq: vi.fn(),
  ticketAttachments: { id: 'ta.id', threadId: 'ta.threadId' },
  ticketThreads: { id: 'tt.id' },
  tickets: { id: 't.id' },
}))

vi.mock('../../audit', () => ({ recordEvent: (...a: unknown[]) => m.recordEvent(...a) }))
vi.mock('../ticket.service', () => ({
  writeActivity: (...a: unknown[]) => m.writeActivity(...a),
  bumpLastActivity: (...a: unknown[]) => m.bumpLastActivity(...a),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchTicketAttachmentAdded: (...a: unknown[]) => m.dAdded(...a),
  dispatchTicketAttachmentRemoved: (...a: unknown[]) => m.dRemoved(...a),
  dispatchTicketThreadUpdated: (...a: unknown[]) => m.dThreadUpdated(...a),
}))

import { attachToThread, listForThread, removeAttachment } from '../ticket.attachments'

const validInput = {
  threadId: 'thread_1' as never,
  uploadedByPrincipalId: 'p1' as never,
  filename: 'file.png',
  mimeType: 'image/png',
  sizeBytes: 1024,
  storageKey: 'key/1',
  publicUrl: 'https://x/f',
}
const thread = (over: Record<string, unknown> = {}) => ({
  id: 'thread_1',
  ticketId: 'ticket_1',
  deletedAt: null,
  audience: 'public',
  sharedWithTeamId: null,
  bodyText: 'hi',
  principalId: 'p1',
  createdAt: new Date('2026-01-01'),
  editedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.threadsFindFirst.mockResolvedValue(thread())
  m.attachmentsFindFirst.mockResolvedValue(undefined)
  m.ticketsFindFirst.mockResolvedValue({ id: 'ticket_1', requesterPrincipalId: 'p1' })
  m.insertReturning.mockResolvedValue([{ id: 'att_1' }])
  m.deleteWhere.mockResolvedValue(undefined)
  m.selectWhere.mockResolvedValue([{ id: 'att_1' }])
  m.dAdded.mockResolvedValue(undefined)
  m.dRemoved.mockResolvedValue(undefined)
  m.dThreadUpdated.mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('attachToThread validation', () => {
  it('rejects missing/too-long filename', async () => {
    await expect(attachToThread({ ...validInput, filename: ' ' })).rejects.toThrow(
      'filename required'
    )
    await expect(attachToThread({ ...validInput, filename: 'x'.repeat(257) })).rejects.toThrow(
      'filename >'
    )
  })
  it('rejects missing mimeType', async () => {
    await expect(attachToThread({ ...validInput, mimeType: ' ' })).rejects.toThrow(
      'mimeType required'
    )
  })
  it('rejects invalid and too-large sizeBytes', async () => {
    await expect(attachToThread({ ...validInput, sizeBytes: 0 })).rejects.toThrow('positive')
    await expect(attachToThread({ ...validInput, sizeBytes: Number.NaN })).rejects.toThrow(
      'positive'
    )
    await expect(attachToThread({ ...validInput, sizeBytes: 999 * 1024 * 1024 })).rejects.toThrow(
      'exceeds'
    )
  })
  it('rejects missing storageKey', async () => {
    await expect(attachToThread({ ...validInput, storageKey: ' ' })).rejects.toThrow(
      'storageKey required'
    )
  })
  it('rejects a missing or deleted thread', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(undefined)
    await expect(attachToThread(validInput)).rejects.toThrow('not found')
    m.threadsFindFirst.mockResolvedValueOnce(thread({ deletedAt: new Date() }))
    await expect(attachToThread(validInput)).rejects.toThrow('not found')
  })
})

describe('attachToThread success', () => {
  it('attaches with a principal actor, long preview, from-requester, and dispatches', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(
      thread({ bodyText: 'x'.repeat(600), principalId: 'p1' })
    )
    const created = await attachToThread(validInput)
    expect(created).toEqual({ id: 'att_1' })
    expect(m.buildEventActor).toHaveBeenCalled()
    expect(m.dAdded).toHaveBeenCalled()
    expect(m.dThreadUpdated).toHaveBeenCalled()
  })
  it('attaches with a service actor (null principal) and a missing ticket ref', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(thread({ principalId: null, bodyText: null }))
    m.ticketsFindFirst.mockResolvedValueOnce(undefined) // loadTicketEventRef fallback {id}
    await attachToThread({ ...validInput, uploadedByPrincipalId: null, publicUrl: null })
    expect(m.buildEventActor).not.toHaveBeenCalled()
  })
  it('swallows dispatch and fallback failures', async () => {
    m.dAdded.mockRejectedValueOnce(new Error('boom'))
    m.dThreadUpdated.mockRejectedValueOnce(new Error('boom2'))
    const created = await attachToThread(validInput)
    expect(created).toEqual({ id: 'att_1' })
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('listForThread', () => {
  it('returns the rows for a thread', async () => {
    expect(await listForThread('thread_1' as never)).toEqual([{ id: 'att_1' }])
  })
})

describe('removeAttachment', () => {
  it('throws when the attachment is missing', async () => {
    m.attachmentsFindFirst.mockResolvedValueOnce(undefined)
    await expect(removeAttachment('att_x' as never, null)).rejects.toThrow('not found')
  })
  it('removes and dispatches when the thread still exists', async () => {
    m.attachmentsFindFirst.mockResolvedValueOnce({
      id: 'att_1',
      threadId: 'thread_1',
      filename: 'f.png',
    })
    m.threadsFindFirst.mockResolvedValueOnce(thread())
    await removeAttachment('att_1' as never, 'p1' as never)
    expect(m.deleteWhere).toHaveBeenCalled()
    expect(m.dRemoved).toHaveBeenCalled()
  })
  it('removes but skips dispatch when the thread is gone (service actor)', async () => {
    m.attachmentsFindFirst.mockResolvedValueOnce({
      id: 'att_1',
      threadId: 'thread_1',
      filename: 'f.png',
    })
    m.threadsFindFirst.mockResolvedValueOnce(undefined)
    await removeAttachment('att_1' as never, null)
    expect(m.dRemoved).not.toHaveBeenCalled()
  })
  it('swallows a removal dispatch failure', async () => {
    m.attachmentsFindFirst.mockResolvedValueOnce({
      id: 'att_1',
      threadId: 'thread_1',
      filename: 'f.png',
    })
    m.threadsFindFirst.mockResolvedValueOnce(thread())
    m.dRemoved.mockRejectedValueOnce(new Error('boom'))
    await removeAttachment('att_1' as never, 'p1' as never)
    expect(console.warn).toHaveBeenCalled()
  })
})
