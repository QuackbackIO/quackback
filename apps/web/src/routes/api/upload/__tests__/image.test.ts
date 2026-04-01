import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSession, mockPrincipal } from '../../__tests__/upload-fixtures'

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
import { isS3Configured, uploadObject, generateStorageKey } from '@/lib/server/storage/s3'
import { handleAdminUpload } from '../image'

function makeRequest(file?: File, prefix?: string): Request {
  const formData = new FormData()
  if (file) formData.append('file', file)
  if (prefix) formData.append('prefix', prefix)
  return new Request('http://localhost/api/upload/image', {
    method: 'POST',
    body: formData,
  })
}

const adminSession = mockSession({ user: { id: 'user_admin', email: 'admin@example.com' } })
const memberSession = mockSession({ user: { id: 'user_member', email: 'member@example.com' } })
const userSession = mockSession({ user: { id: 'user_regular', email: 'user@example.com' } })

const adminPrincipal = mockPrincipal({ role: 'admin' })
const memberPrincipal = mockPrincipal({ role: 'member' })
const userPrincipal = mockPrincipal({ role: 'user' })

describe('POST /api/upload/image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isS3Configured).mockReturnValue(true)
  })

  it('returns 401 when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const res = await handleAdminUpload({ request: makeRequest() })
    expect(res.status).toBe(401)
  })

  it('returns 403 for portal users (non-admin/member)', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(userSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(userPrincipal)
    const res = await handleAdminUpload({ request: makeRequest() })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Forbidden' })
  })

  it('allows members to upload', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(memberSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(memberPrincipal)
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/uploads/img.jpg')
    const file = new File(['img'], 'img.jpg', { type: 'image/jpeg' })
    const res = await handleAdminUpload({ request: makeRequest(file) })
    expect(res.status).toBe(200)
  })

  it('returns 503 when S3 is not configured', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(adminSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(adminPrincipal)
    vi.mocked(isS3Configured).mockReturnValue(false)
    const res = await handleAdminUpload({ request: makeRequest() })
    expect(res.status).toBe(503)
  })

  it('returns 400 when no file provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(adminSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(adminPrincipal)
    const res = await handleAdminUpload({ request: makeRequest() })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'No file provided' })
  })

  it('returns 400 for invalid file type', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(adminSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(adminPrincipal)
    const file = new File(['data'], 'file.txt', { type: 'text/plain' })
    const res = await handleAdminUpload({ request: makeRequest(file) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid file type' })
  })

  it('returns 400 when file exceeds max size', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(adminSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(adminPrincipal)
    const oversized = new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', {
      type: 'image/jpeg',
    })
    const res = await handleAdminUpload({ request: makeRequest(oversized) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('too large') })
  })

  it('uses the provided prefix when it is in the allowlist', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(adminSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(adminPrincipal)
    vi.mocked(uploadObject).mockResolvedValueOnce(
      'https://cdn.example.com/changelog-images/img.png'
    )
    const file = new File(['img'], 'img.png', { type: 'image/png' })
    await handleAdminUpload({ request: makeRequest(file, 'changelog-images') })
    expect(generateStorageKey).toHaveBeenCalledWith('changelog-images', expect.any(String))
  })

  it('falls back to uploads prefix for unknown prefixes', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(adminSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(adminPrincipal)
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/uploads/img.png')
    const file = new File(['img'], 'img.png', { type: 'image/png' })
    await handleAdminUpload({ request: makeRequest(file, 'totally-unknown-prefix') })
    expect(generateStorageKey).toHaveBeenCalledWith('uploads', expect.any(String))
  })

  it('accepts all allowed prefixes', async () => {
    const allowedPrefixes = [
      'uploads',
      'changelog-images',
      'changelog',
      'post-images',
      'help-center',
    ]
    for (const prefix of allowedPrefixes) {
      vi.mocked(auth.api.getSession).mockResolvedValueOnce(adminSession)
      vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(adminPrincipal)
      vi.mocked(uploadObject).mockResolvedValueOnce(`https://cdn.example.com/${prefix}/img.png`)
      const file = new File(['img'], 'img.png', { type: 'image/png' })
      await handleAdminUpload({ request: makeRequest(file, prefix) })
      expect(generateStorageKey).toHaveBeenCalledWith(prefix, expect.any(String))
      vi.clearAllMocks()
      vi.mocked(isS3Configured).mockReturnValue(true)
    }
  })

  it('uploads image and returns publicUrl', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(adminSession)
    vi.mocked(db.query.principal.findFirst).mockResolvedValueOnce(adminPrincipal)
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/post-images/photo.gif')
    const file = new File(['img'], 'photo.gif', { type: 'image/gif' })
    const res = await handleAdminUpload({ request: makeRequest(file, 'post-images') })
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty(
      'publicUrl',
      'https://cdn.example.com/post-images/photo.gif'
    )
  })
})
