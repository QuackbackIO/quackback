// @vitest-environment node
/**
 * With `USER_CONTENT_URL` set, the app's file viewer fetches bytes from a
 * different origin, so the storage route answers CORS for exactly the app's
 * origin (no credentials) and handles the preflight a Range request may need.
 * With it unset, nothing about the route changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  s3Bucket: 'env-bucket',
  s3Region: 'env-region',
  s3AccessKeyId: 'env-access-key',
  s3SecretAccessKey: 'fixture-secret',
  s3ForcePathStyle: true,
  s3Proxy: false,
  baseUrl: 'https://app.example.com',
  userContentUrl: undefined as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const getS3Object = vi.hoisted(() =>
  vi.fn(async (_key: string, range?: string) =>
    range
      ? {
          body: new Blob([new Uint8Array([0x25, 0x50])]).stream(),
          contentType: 'application/pdf',
          contentLength: 2,
          contentRange: 'bytes 0-1/4',
          acceptRanges: 'bytes',
        }
      : {
          body: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]).stream(),
          contentType: 'application/pdf',
          contentLength: 4,
        }
  )
)
vi.mock('@/lib/server/storage/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
  getS3Object,
  generatePresignedGetUrl: vi.fn(async () => 'https://bucket.example.com/presigned'),
}))

const { getPublicUrlOrNull } = await import('@/lib/server/storage/s3')
const { handleStorageGet, handleStorageOptions } = await import('../$')

const APP = 'https://app.example.com'
const FILES_HOST = 'https://files.example.com'
const FILE_KEY = 'files/2026/10/0b5c3f43-8d0a-4c4e-9a59-2f1d1f6c1a11-report.pdf'

function get(path: string, headers: Record<string, string> = {}, host = FILES_HOST) {
  return handleStorageGet({ request: new Request(`${host}${path}`, { headers }) })
}

function preflight(headers: Record<string, string>) {
  return handleStorageOptions({
    request: new Request(`${FILES_HOST}/api/storage/${FILE_KEY}`, { method: 'OPTIONS', headers }),
  })
}

const viewerUrl = () => `${getPublicUrlOrNull(FILE_KEY)}&proxy=1`

beforeEach(() => {
  mockConfig.userContentUrl = undefined
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 1, 9, 30))
  getS3Object.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('with USER_CONTENT_URL set', () => {
  beforeEach(() => {
    mockConfig.userContentUrl = FILES_HOST
  })

  it('serves a file on the user-content host in a single-workspace install', async () => {
    const res = await get(viewerUrl(), { Origin: APP })
    expect(res.status).toBe(200)
    expect(getS3Object).toHaveBeenCalledWith(FILE_KEY)
  })

  it("answers CORS for the app's origin, without credentials", async () => {
    const res = await get(viewerUrl(), { Origin: APP })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP)
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    const exposed = (res.headers.get('Access-Control-Expose-Headers') ?? '')
      .split(',')
      .map((h) => h.trim())
    expect(exposed).toEqual(
      expect.arrayContaining(['Content-Range', 'Content-Length', 'Accept-Ranges'])
    )
  })

  it('varies on Origin as well as Host', async () => {
    const variants: Array<Record<string, string>> = [
      { Origin: APP },
      { Origin: 'https://evil.example' },
      {},
    ]
    for (const headers of variants) {
      const vary = (await get(viewerUrl(), headers)).headers.get('Vary') ?? ''
      expect(vary.split(',').map((v) => v.trim())).toEqual(
        expect.arrayContaining(['Host', 'Origin'])
      )
    }
  })

  it('grants no other origin, and nothing to a request without one', async () => {
    expect(
      (await get(viewerUrl(), { Origin: 'https://evil.example' })).headers.get(
        'Access-Control-Allow-Origin'
      )
    ).toBeNull()
    expect(
      (await get(viewerUrl(), { Origin: FILES_HOST })).headers.get('Access-Control-Allow-Origin')
    ).toBeNull()
    expect((await get(viewerUrl())).headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('lets the viewer read a range response', async () => {
    const res = await get(viewerUrl(), { Origin: APP, Range: 'bytes=0-1' })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 0-1/4')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP)
  })

  it('lets the viewer read a refusal', async () => {
    const res = await get(`/api/storage/${FILE_KEY}?proxy=1`, { Origin: APP })
    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP)
  })

  it("answers the preflight for the app's origin, allowing Range", async () => {
    const res = await preflight({
      Origin: APP,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'range',
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP)
    expect(res.headers.get('Access-Control-Allow-Methods')).toMatch(/\bGET\b/)
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/\bRange\b/i)
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(res.headers.get('Vary')).toMatch(/\bOrigin\b/)
  })

  it('answers the preflight for any other origin without a grant', async () => {
    const res = await preflight({ Origin: 'https://evil.example' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Headers')).toBeNull()
  })
})

describe('without USER_CONTENT_URL', () => {
  it('sends no CORS headers and varies on Host only', async () => {
    const res = await get(viewerUrl(), { Origin: APP }, APP)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull()
    expect(res.headers.get('Vary')).toBe('Host')
  })

  it('grants nothing on a preflight', async () => {
    const res = await preflight({ Origin: APP, 'Access-Control-Request-Headers': 'range' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Headers')).toBeNull()
  })
})
