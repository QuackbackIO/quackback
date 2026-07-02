// @vitest-environment happy-dom
/**
 * Differential-coverage tests for the widget thread-attachment upload handler —
 * the full guard chain (gate / session / anonymous / uploads-disabled / s3 /
 * ownership / thread checks / file validation), the happy 201 path, and the
 * error mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  getWidgetSession: vi.fn(),
  getTicketForPortalUser: vi.fn(),
  getThread: vi.fn(),
  getWidgetConfig: vi.fn(),
  isS3Configured: vi.fn(),
  isAllowedAttachmentType: vi.fn(),
  generateStorageKey: vi.fn(() => 'key/1'),
  uploadObject: vi.fn(() => Promise.resolve('https://cdn/x')),
  attachToThread: vi.fn(),
  principalFindFirst: vi.fn(),
  mapErr: vi.fn((..._a: unknown[]): Response | null => null),
}))
vi.mock('@/lib/server/db', () => ({
  db: { query: { principal: { findFirst: m.principalFindFirst } } },
  eq: vi.fn(),
  principal: { userId: 'pr.userId' },
}))
vi.mock('@/lib/server/functions/widget-auth', () => ({ getWidgetSession: m.getWidgetSession }))
vi.mock('@/lib/server/domains/tickets/ticket.portal-query', () => ({
  getTicketForPortalUser: m.getTicketForPortalUser,
}))
vi.mock('@/lib/server/domains/tickets', () => ({
  getThread: m.getThread,
  attachToThread: m.attachToThread,
}))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: m.getWidgetConfig,
}))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Configured: m.isS3Configured,
  isAllowedAttachmentType: m.isAllowedAttachmentType,
  MAX_ATTACHMENT_FILE_SIZE: 25 * 1024 * 1024,
  generateStorageKey: m.generateStorageKey,
  uploadObject: m.uploadObject,
}))
vi.mock('@/lib/server/widget/cors', () => ({
  widgetCorsHeaders: () => new Headers(),
  widgetJsonError: (code: string, message: string, status: number) =>
    Response.json({ error: { code, message } }, { status }),
  mapDomainErrorToResponse: (e: unknown) => m.mapErr(e),
}))
vi.mock('@/lib/server/widget/ticketing-gate', () => ({ widgetTicketingGate: () => m.gate() }))

import { handleWidgetThreadAttachmentUpload } from '../tickets.$ticketId.threads.$threadId.attachments'

const params = { ticketId: 'ticket_1', threadId: 'thread_1' }
const fileReq = (file?: File) => {
  const fd = new FormData()
  if (file) fd.set('file', file)
  return { formData: async () => fd } as never
}
const call = (request: unknown = fileReq(new File(['x'], 'a.png', { type: 'image/png' }))) =>
  handleWidgetThreadAttachmentUpload({ request, params } as never)

beforeEach(() => {
  vi.clearAllMocks()
  m.gate.mockResolvedValue(null)
  m.getWidgetSession.mockResolvedValue({ principal: { type: 'user' }, user: { id: 'u1' } })
  m.getWidgetConfig.mockResolvedValue({ imageUploadsInWidget: true })
  m.isS3Configured.mockReturnValue(true)
  m.getTicketForPortalUser.mockResolvedValue({ id: 'ticket_1' })
  m.getThread.mockResolvedValue({
    id: 'thread_1',
    ticketId: 'ticket_1',
    deletedAt: null,
    audience: 'public',
    principalId: 'p_viewer',
  })
  m.principalFindFirst.mockResolvedValue({ id: 'p_viewer' })
  m.isAllowedAttachmentType.mockReturnValue(true)
  m.attachToThread.mockResolvedValue({
    id: 'att_1',
    threadId: 'thread_1',
    filename: 'a.png',
    mimeType: 'image/png',
    sizeBytes: 1,
    publicUrl: 'https://cdn/x',
    createdAt: new Date('2026-01-01'),
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('attachment upload guards', () => {
  it('returns the gate response when ticketing is disabled', async () => {
    m.gate.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect((await call()).status).toBe(404)
  })
  it('401 without a session, 403 for anonymous', async () => {
    m.getWidgetSession.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(401)
    m.getWidgetSession.mockResolvedValueOnce({
      principal: { type: 'anonymous' },
      user: { id: 'u1' },
    })
    expect((await call()).status).toBe(403)
  })
  it('403 when uploads disabled, 503 when S3 not configured', async () => {
    m.getWidgetConfig.mockResolvedValueOnce({ imageUploadsInWidget: false })
    expect((await call()).status).toBe(403)
    m.isS3Configured.mockReturnValueOnce(false)
    expect((await call()).status).toBe(503)
  })
  it('404 for missing/deleted/mismatched thread; 403 for non-public; 403 for non-owner', async () => {
    m.getThread.mockResolvedValueOnce(undefined)
    expect((await call()).status).toBe(404)
    m.getThread.mockResolvedValueOnce({
      id: 'thread_1',
      ticketId: 'other',
      audience: 'public',
      principalId: 'p_viewer',
    })
    expect((await call()).status).toBe(404)
    m.getThread.mockResolvedValueOnce({
      id: 'thread_1',
      ticketId: 'ticket_1',
      deletedAt: null,
      audience: 'internal',
      principalId: 'p_viewer',
    })
    expect((await call()).status).toBe(403)
    m.principalFindFirst.mockResolvedValueOnce({ id: 'someone-else' })
    expect((await call()).status).toBe(403)
  })
})

describe('file validation + happy path', () => {
  it('400 on bad form / missing file / bad type / empty / too large', async () => {
    expect(
      (
        await call({
          formData: async () => {
            throw new Error('nope')
          },
        } as never)
      ).status
    ).toBe(400)
    expect((await call(fileReq())).status).toBe(400)
    m.isAllowedAttachmentType.mockReturnValueOnce(false)
    expect((await call()).status).toBe(400)
    expect((await call(fileReq(new File([], 'e.png', { type: 'image/png' })))).status).toBe(400)
    const big = new File([new Uint8Array(2)], 'big.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 99 * 1024 * 1024 })
    expect((await call(fileReq(big))).status).toBe(400)
  })
  it('uploads and returns 201', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    expect(m.uploadObject).toHaveBeenCalled()
    expect(m.attachToThread).toHaveBeenCalled()
  })
  it('maps a domain error, else 500', async () => {
    m.getTicketForPortalUser.mockRejectedValueOnce(
      Object.assign(new Error('nf'), { code: 'TICKET_NOT_FOUND' })
    )
    m.mapErr.mockReturnValueOnce(new Response(null, { status: 404 }))
    expect((await call()).status).toBe(404)
    m.getTicketForPortalUser.mockRejectedValueOnce(new Error('boom'))
    expect((await call()).status).toBe(500)
  })
})
