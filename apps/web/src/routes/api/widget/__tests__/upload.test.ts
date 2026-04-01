import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      session: { findFirst: vi.fn() },
      principal: { findFirst: vi.fn() },
    },
  },
  session: {},
  principal: {},
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', async () => {
  const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
  return createS3MockFactory()
})

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(),
}))

import { db } from '@/lib/server/db'
import { isS3Configured, uploadObject } from '@/lib/server/storage/s3'
import { getWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import { handleWidgetUpload } from '../upload'

function makeRequest(file?: File, token?: string): Request {
  const formData = new FormData()
  if (file) formData.append('file', file)
  return new Request('http://localhost/api/widget/upload', {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

const sessionRecord = {
  token: 'valid-token',
  userId: 'usr_1',
  expiresAt: new Date(Date.now() + 3600_000),
}
const identifiedPrincipal = { type: 'user', userId: 'usr_1' }
const anonymousPrincipal = { type: 'anonymous', userId: 'usr_2' }

describe('POST /api/widget/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isS3Configured).mockReturnValue(true)
    vi.mocked(getWidgetConfig).mockResolvedValue({ imageUploadsInWidget: true } as any)
  })

  it('returns 401 when no Authorization header', async () => {
    const res = await handleWidgetUpload({ request: makeRequest() })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 401 when Bearer token not found in DB', async () => {
    vi.mocked(db.query.session.findFirst).mockResolvedValueOnce(undefined)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'bad-token') })
    expect(res.status).toBe(401)
  })

  it('returns 403 when principal is anonymous', async () => {
    vi.mocked(db.query.session.findFirst).mockResolvedValueOnce(sessionRecord as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(anonymousPrincipal as any)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Authentication') })
  })

  it('returns 403 when imageUploadsInWidget is disabled', async () => {
    vi.mocked(db.query.session.findFirst).mockResolvedValueOnce(sessionRecord as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    vi.mocked(getWidgetConfig).mockResolvedValueOnce({ imageUploadsInWidget: false } as any)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('disabled') })
  })

  it('returns 503 when S3 is not configured', async () => {
    vi.mocked(db.query.session.findFirst).mockResolvedValueOnce(sessionRecord as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    vi.mocked(isS3Configured).mockReturnValue(false)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(503)
  })

  it('returns 400 when no file provided', async () => {
    vi.mocked(db.query.session.findFirst).mockResolvedValueOnce(sessionRecord as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'No file provided' })
  })

  it('returns 400 for invalid file type', async () => {
    vi.mocked(db.query.session.findFirst).mockResolvedValueOnce(sessionRecord as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' })
    const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid file type' })
  })

  it('returns 400 when file exceeds max size', async () => {
    vi.mocked(db.query.session.findFirst).mockResolvedValueOnce(sessionRecord as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    const oversized = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    })
    const res = await handleWidgetUpload({ request: makeRequest(oversized, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('too large') })
  })

  it('uploads image and returns publicUrl for identified widget user', async () => {
    vi.mocked(db.query.session.findFirst).mockResolvedValueOnce(sessionRecord as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/widget-images/shot.webp')
    const file = new File(['img'], 'shot.webp', { type: 'image/webp' })
    const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('publicUrl')
    expect(uploadObject).toHaveBeenCalledWith(
      expect.stringContaining('widget-images'),
      expect.any(Buffer),
      'image/webp'
    )
  })
})
