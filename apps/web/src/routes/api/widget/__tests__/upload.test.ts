import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSession, mockImageFile } from '../../__tests__/upload-fixtures'

vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/server/storage/s3', async () => {
  const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
  return createS3MockFactory()
})

const mockGetSettings = vi.fn()
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}))

const mockIncrementBucket = vi.fn()
const mockBucketRetryAfter = vi.fn()
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => mockIncrementBucket(...args),
  bucketRetryAfter: (...args: unknown[]) => mockBucketRetryAfter(...args),
}))

const mockFindPrincipal = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { principal: { findFirst: (...args: unknown[]) => mockFindPrincipal(...args) } } },
}))

const gate = vi.hoisted(() => ({
  allowAnonymous: true,
  canSubmit: false as boolean | undefined,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn(async () => ({ features: { allowAnonymous: gate.allowAnonymous } })),
}))
vi.mock('@/lib/server/test-customer-feedback', () => ({
  resolveTestFeedbackActor: vi.fn(async (actor: object) => ({
    ...actor,
    ...(gate.canSubmit === undefined ? {} : { testFeedback: { canSubmit: gate.canSubmit } }),
  })),
}))

import { auth } from '@/lib/server/auth'
import { isS3Usable, uploadObject } from '@/lib/server/storage/s3'
import { handleWidgetUpload } from '../upload'

function makeRequest(
  file?: File,
  token?: string,
  extraHeaders: Record<string, string> = {}
): Request {
  const formData = new FormData()
  if (file) formData.append('file', file)
  const headers: Record<string, string> = { ...extraHeaders }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request('http://localhost/api/widget/upload', {
    method: 'POST',
    body: formData,
    headers,
  })
}

const validSession = mockSession()

/** Stub the better-auth session resolution as a valid widget visitor. */
function authAs() {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(validSession)
}

describe('POST /api/widget/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isS3Usable).mockReturnValue(true)
    mockGetSettings.mockResolvedValue({ id: 'settings_1' })
    mockIncrementBucket.mockResolvedValue({ count: 1 })
    mockBucketRetryAfter.mockResolvedValue(42)
    mockFindPrincipal.mockResolvedValue({ role: 'user', blockedAt: null })
    gate.allowAnonymous = true
    gate.canSubmit = undefined
  })

  describe('with anonymous interaction off', () => {
    const anonymous = { id: 'principal_anon', type: 'anonymous', role: 'user', blockedAt: null }

    it('refuses an anonymous session and stores nothing', async () => {
      gate.allowAnonymous = false
      authAs()
      mockFindPrincipal.mockResolvedValueOnce(anonymous)
      const res = await handleWidgetUpload({
        request: makeRequest(mockImageFile('photo.jpg', 'image/jpeg'), 'token'),
      })
      expect(res.status).toBe(403)
      expect(uploadObject).not.toHaveBeenCalled()
      expect(mockIncrementBucket).not.toHaveBeenCalled()
    })

    it('still lets an identified widget user upload', async () => {
      gate.allowAnonymous = false
      authAs()
      mockFindPrincipal.mockResolvedValueOnce({ ...anonymous, type: 'user' })
      vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/widget-media/a.jpg')
      const res = await handleWidgetUpload({
        request: makeRequest(mockImageFile('photo.jpg', 'image/jpeg'), 'token'),
      })
      expect(res.status).toBe(200)
    })

    it("lets a teammate's test customer upload only while it may still post", async () => {
      gate.allowAnonymous = false
      gate.canSubmit = true
      authAs()
      mockFindPrincipal.mockResolvedValueOnce(anonymous)
      vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/widget-media/a.jpg')
      const ok = await handleWidgetUpload({
        request: makeRequest(mockImageFile('photo.jpg', 'image/jpeg'), 'token'),
      })
      expect(ok.status).toBe(200)

      gate.canSubmit = false
      authAs()
      mockFindPrincipal.mockResolvedValueOnce(anonymous)
      const refused = await handleWidgetUpload({
        request: makeRequest(mockImageFile('photo.jpg', 'image/jpeg'), 'token'),
      })
      expect(refused.status).toBe(403)
    })
  })

  it('refuses a blocked person with the typed BLOCKED refusal and stores nothing', async () => {
    authAs()
    mockFindPrincipal.mockResolvedValueOnce({ role: 'user', blockedAt: new Date() })
    const res = await handleWidgetUpload({
      request: makeRequest(mockImageFile('photo.jpg', 'image/jpeg'), 'token'),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: "You can't post, vote or comment here.",
      code: 'BLOCKED',
    })
    expect(uploadObject).not.toHaveBeenCalled()
    expect(mockIncrementBucket).not.toHaveBeenCalled()
  })

  it('lets a teammate upload even with a block left on their row', async () => {
    authAs()
    mockFindPrincipal.mockResolvedValueOnce({ role: 'member', blockedAt: new Date() })
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/widget-media/a.jpg')
    const res = await handleWidgetUpload({
      request: makeRequest(mockImageFile('photo.jpg', 'image/jpeg'), 'token'),
    })
    expect(res.status).toBe(200)
  })

  it('returns 401 when there is no valid widget session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const res = await handleWidgetUpload({ request: makeRequest() })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 503 when S3 is not configured', async () => {
    authAs()
    vi.mocked(isS3Usable).mockReturnValue(false)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(503)
  })

  it('returns 400 when no file provided', async () => {
    authAs()
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'No file provided' })
  })

  it('returns 400 for invalid file type', async () => {
    authAs()
    const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' })
    const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid file type' })
  })

  it('returns 400 when file exceeds max size', async () => {
    authAs()
    const oversized = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    })
    const res = await handleWidgetUpload({ request: makeRequest(oversized, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('too large') })
  })

  it('uploads image and returns publicUrl for any valid widget session', async () => {
    // Identified or anonymous — the route only requires a valid session, so a
    // live-chat visitor without an account can attach images too.
    authAs()
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/widget-images/shot.webp')
    const file = mockImageFile('shot.webp', 'image/webp')
    const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('publicUrl')
    expect(uploadObject).toHaveBeenCalledWith(
      expect.stringContaining('widget-media'),
      expect.anything(),
      'image/webp'
    )
  })

  it('returns 503 when the workspace is unavailable', async () => {
    authAs()
    mockGetSettings.mockResolvedValue(null)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(503)
    expect(mockIncrementBucket).not.toHaveBeenCalled()
  })

  it('keys the workspace bucket off the resolved workspace id, not the Host header', async () => {
    // A caller could vary the Host header per request to dodge a Host-keyed
    // bucket. Since Round 2, the workspace bucket is keyed on settings.id, so
    // the bucket key stays fixed regardless of what Host is sent.
    authAs()
    mockGetSettings.mockResolvedValue({ id: 'settings_fixed' })
    await handleWidgetUpload({
      request: makeRequest(undefined, 'valid-token', { Host: 'attacker-controlled.example' }),
    })
    const keys = mockIncrementBucket.mock.calls.map((call) => (call[0] as { key: string }).key)
    expect(keys).toContain('widget-upload:workspace:settings_fixed')
    expect(keys.some((k: string) => k.includes('attacker-controlled.example'))).toBe(false)
  })

  it('429s when the workspace bucket is over the limit, even from a fresh session/IP', async () => {
    authAs()
    mockIncrementBucket.mockImplementation(async (spec: { key: string }) => ({
      count: spec.key.includes(':workspace:') ? 201 : 1,
    }))
    const file = mockImageFile('shot.webp', 'image/webp')
    const res = await handleWidgetUpload({
      request: makeRequest(file, 'valid-token', { Host: 'yet-another-host.example' }),
    })
    expect(res.status).toBe(429)
    expect(uploadObject).not.toHaveBeenCalled()
  })
})
