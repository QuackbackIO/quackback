import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockHandleFileUploadRequest = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/files/files.upload', () => ({
  handleFileUploadRequest: (...a: unknown[]) => mockHandleFileUploadRequest(...a),
}))

import { Route } from '../index'

type Handler = (a: { request: Request }) => Promise<Response>
const handler = (): Handler =>
  (Route as unknown as { options: { server: { handlers: { POST: Handler } } } }).options.server
    .handlers.POST

const PRINCIPAL_ID = 'principal_01h455vb4pex5vsknk084sn02q'

const req = (body: BodyInit | null = new Uint8Array([1, 2, 3])) =>
  new Request('http://localhost/api/v1/files?name=a.png', { method: 'POST', body })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ principalId: PRINCIPAL_ID, role: 'admin' })
})

describe('POST /api/v1/files', () => {
  it('gates with the conversation-reply permission and uploads as the key principal', async () => {
    mockHandleFileUploadRequest.mockResolvedValue(
      Response.json(
        {
          fileId: 'file_01h455vb4pex5vsknk084sn02q',
          url: '/api/storage/files/a.png?read=sig',
          name: 'a.png',
          contentType: 'image/png',
          size: 3,
          family: 'image',
        },
        { status: 201 }
      )
    )

    const res = await handler()({ request: req() })

    expect(mockAuth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'conversation.reply' })
    )
    expect(mockHandleFileUploadRequest).toHaveBeenCalledWith(expect.anything(), {
      source: 'api',
      uploadedById: PRINCIPAL_ID,
      unverifiedSender: false,
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({
      data: {
        fileId: 'file_01h455vb4pex5vsknk084sn02q',
        url: '/api/storage/files/a.png?read=sig',
        name: 'a.png',
        contentType: 'image/png',
        size: 3,
        family: 'image',
      },
    })
  })

  it('wraps a rejection reason into the v1 error envelope with the same status', async () => {
    mockHandleFileUploadRequest.mockResolvedValue(
      Response.json({ error: 'Over 25 MB', reason: 'too_large' }, { status: 413 })
    )

    const res = await handler()({ request: req() })
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error.message).toBe('Over 25 MB')
  })

  it('wraps a blocked file type as a v1 error', async () => {
    mockHandleFileUploadRequest.mockResolvedValue(
      Response.json({ error: 'File type not allowed', reason: 'blocked' }, { status: 415 })
    )

    const res = await handler()({ request: req() })
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('wraps a missing-name 400 with no reason field', async () => {
    mockHandleFileUploadRequest.mockResolvedValue(
      Response.json({ error: 'Missing file name' }, { status: 400 })
    )

    const res = await handler()({ request: req() })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toBe('Missing file name')
  })

  it('wraps storage-unavailable as a 503', async () => {
    mockHandleFileUploadRequest.mockResolvedValue(
      Response.json({ error: 'File storage is not configured' }, { status: 503 })
    )

    const res = await handler()({ request: req() })
    expect(res.status).toBe(503)
  })

  it('propagates an auth failure before touching the upload handler', async () => {
    const { ForbiddenError } = await import('@/lib/shared/errors')
    mockAuth.mockRejectedValue(new ForbiddenError('FORBIDDEN', 'nope'))

    const res = await handler()({ request: req() })
    expect(res.status).toBe(403)
    expect(mockHandleFileUploadRequest).not.toHaveBeenCalled()
  })
})
