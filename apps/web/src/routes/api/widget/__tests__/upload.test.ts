import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSession, mockImageFile } from '../../__tests__/upload-fixtures'

vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/server/storage/s3', async () => {
  const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
  return createS3MockFactory()
})

// The route gates uploads on widget config; only `imageUploadsInWidget`
// matters for these tests, so resolve it enabled.
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(),
}))

import { auth } from '@/lib/server/auth'
import { isS3Configured, uploadObject } from '@/lib/server/storage/s3'
import { getWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import { DEFAULT_WIDGET_CONFIG } from '@/lib/server/domains/settings/settings.types'
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

/** Stub the better-auth session resolution as a valid widget visitor. */
function authAs() {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(validSession)
}

describe('POST /api/widget/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isS3Configured).mockReturnValue(true)
    vi.mocked(getWidgetConfig).mockResolvedValue({
      ...DEFAULT_WIDGET_CONFIG,
      imageUploadsInWidget: true,
    })
  })

  it('returns 401 when there is no valid widget session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const res = await handleWidgetUpload({ request: makeRequest() })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 403 when image uploads are disabled for the widget', async () => {
    authAs()
    vi.mocked(getWidgetConfig).mockResolvedValueOnce({
      ...DEFAULT_WIDGET_CONFIG,
      imageUploadsInWidget: false,
    })
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Image uploads are disabled' })
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
