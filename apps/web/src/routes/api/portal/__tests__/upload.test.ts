import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: vi.fn() },
    },
  },
  principal: {},
  eq: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', async () => {
  const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
  return createS3MockFactory()
})

import { auth } from '@/lib/server/auth'
import { db } from '@/lib/server/db'
import { isS3Configured, uploadObject } from '@/lib/server/storage/s3'
import { handlePortalUpload } from '../upload'

function makeRequest(file?: File, headers?: Record<string, string>): Request {
  const formData = new FormData()
  if (file) formData.append('file', file)
  return new Request('http://localhost/api/portal/upload', {
    method: 'POST',
    body: formData,
    headers,
  })
}

const identifiedSession = {
  user: { id: 'usr_1', email: 'user@example.com', name: 'User' },
}
const anonymousSession = {
  user: { id: 'usr_2', email: null, name: null },
}
const identifiedPrincipal = { type: 'user', userId: 'usr_1' }
const anonymousPrincipal = { type: 'anonymous', userId: 'usr_2' }

describe('POST /api/portal/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isS3Configured).mockReturnValue(true)
  })

  it('returns 401 when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const res = await handlePortalUpload({ request: makeRequest() })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 403 when session is anonymous', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(anonymousSession as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(anonymousPrincipal as any)
    const res = await handlePortalUpload({ request: makeRequest() })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Authentication') })
  })

  it('returns 503 when S3 is not configured', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    vi.mocked(isS3Configured).mockReturnValue(false)
    const res = await handlePortalUpload({ request: makeRequest() })
    expect(res.status).toBe(503)
  })

  it('returns 400 when no file provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    const res = await handlePortalUpload({ request: makeRequest() })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'No file provided' })
  })

  it('returns 400 for invalid file type', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    const file = new File(['data'], 'clip.mp4', { type: 'video/mp4' })
    const res = await handlePortalUpload({ request: makeRequest(file) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid file type' })
  })

  it('returns 400 when file exceeds max size', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    const oversized = new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', {
      type: 'image/jpeg',
    })
    const res = await handlePortalUpload({ request: makeRequest(oversized) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('too large') })
  })

  it('uploads image and returns publicUrl for identified user', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/portal-images/photo.jpg')
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    const res = await handlePortalUpload({ request: makeRequest(file) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('publicUrl')
    expect(uploadObject).toHaveBeenCalledWith(
      expect.stringContaining('portal-images'),
      expect.any(Buffer),
      'image/jpeg'
    )
  })

  it('uses portal-images prefix for storage key', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(identifiedSession as any)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(identifiedPrincipal as any)
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/portal-images/img.png')
    const file = new File(['img'], 'img.png', { type: 'image/png' })
    await handlePortalUpload({ request: makeRequest(file) })
    const { generateStorageKey } = await import('@/lib/server/storage/s3')
    expect(generateStorageKey).toHaveBeenCalledWith('portal-images', expect.any(String))
  })
})
