import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSession, mockImageFile, mockPrincipal } from '../../__tests__/upload-fixtures'

// The route resolves auth via direct DB lookups (session token + principal),
// not better-auth's getSession. Mock `@/lib/server/db` so the route's
// `db.query.session.findFirst` / `db.query.principal.findFirst` are
// test-controlled, while keeping the real schema tables + drizzle operators
// (eq/and/gt) — the operators just build `where` clauses our stubbed
// findFirst ignores.
// Hoisted so the vi.mock factory (also hoisted) can close over them.
const { sessionFindFirst, principalFindFirst } = vi.hoisted(() => ({
  sessionFindFirst: vi.fn(),
  principalFindFirst: vi.fn(),
}))
vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      query: {
        session: { findFirst: sessionFindFirst },
        principal: { findFirst: principalFindFirst },
      },
    },
  }
})

vi.mock('@/lib/server/storage/s3', async () => {
  const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
  return createS3MockFactory()
})

// The route gates uploads on widget config; only `imageUploadsInWidget`
// matters for these tests, so resolve it enabled.
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn().mockResolvedValue({ imageUploadsInWidget: true }),
}))

// `ensureNotSuspended()` lazy-imports `getTenantSettings`; stub it as `null`
// so the suspension guard treats the workspace as 'active' (the default).
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: vi.fn().mockResolvedValue(null),
}))

import { isS3Configured, uploadObject } from '@/lib/server/storage/s3'
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

const validSession = mockSession()

/**
 * Stub the DB-backed auth resolution as a valid, non-anonymous widget visitor:
 * an unexpired session whose userId maps to a `user`-type principal.
 */
function authAs() {
  const { token, userId, expiresAt } = validSession.session
  sessionFindFirst.mockResolvedValueOnce({ token, userId, expiresAt })
  principalFindFirst.mockResolvedValueOnce(mockPrincipal({ type: 'user' }))
}

describe('POST /api/widget/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks resets call history but not queued mockResolvedValueOnce
    // implementations; reset the auth lookups so no leftover queued value
    // from a prior test leaks into the next.
    sessionFindFirst.mockReset()
    principalFindFirst.mockReset()
    vi.mocked(isS3Configured).mockReturnValue(true)
  })

  it('returns 401 when there is no valid widget session', async () => {
    // No Bearer header → unauthorized before any session lookup runs.
    const res = await handleWidgetUpload({ request: makeRequest() })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 503 when S3 is not configured', async () => {
    authAs()
    vi.mocked(isS3Configured).mockReturnValue(false)
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
      expect.stringContaining('widget-images'),
      expect.any(Buffer),
      'image/webp'
    )
  })
})
