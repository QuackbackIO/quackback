/**
 * getS3Object (the proxied read path) must fetch bytes through a presigned URL
 * with the runtime's native `fetch`, never through the SDK's `GetObjectCommand`
 * body stream: on Bun that stream rides `node:https`, whose compat layer can
 * stop emitting data after enough requests (oven-sh/bun#26066) and leaves
 * every later proxied read hanging.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workspaceIdFor } from '@/lib/server/__tests__/workspace-scope'

vi.mock('@/lib/server/config', () => ({
  config: {
    s3Bucket: 'env-bucket',
    s3Region: 'env-region',
    s3Endpoint: undefined,
    s3AccessKeyId: 'env-access-key',
    s3SecretAccessKey: 'env-secret-key',
    s3ForcePathStyle: true,
    s3PublicUrl: undefined,
    s3Proxy: true,
    baseUrl: 'https://env-app.example.net',
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: vi.fn(async () => null) } } },
}))

const mockSend = vi.fn(async () => ({}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: mockSend, destroy: vi.fn() }
  }),
  PutObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
  GetObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
  DeleteObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
}))

const PRESIGNED_URL = 'https://storage.example.com/presigned?X-Amz-Signature=stub'

const mockGetSignedUrl = vi.fn(async (..._args: unknown[]) => PRESIGNED_URL)

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}))

const { getS3Object } = await import('../s3')
const { WORKSPACE_NAMESPACE_ROOT } = await import('../namespace')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

const KEY = 'changelog-images/2026/09/abc-rehost-1.jpeg'
const OBJECT_NAME = `${WORKSPACE_NAMESPACE_ROOT}/${workspaceIdFor('workspace-alpha')}/${KEY}`

const read = (range?: string) => withWorkspace('workspace-alpha', () => getS3Object(KEY, range))

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => response())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  mockSend.mockClear()
  mockGetSignedUrl.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getS3Object', () => {
  it('presigns the namespaced key and reads the bytes with native fetch, not GetObjectCommand', async () => {
    const bytes = new Uint8Array(256 * 1024).fill(7)
    const fetchMock = stubFetch(
      () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    )

    const { body, contentType } = await read()

    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1)
    const [, command, opts] = mockGetSignedUrl.mock.calls[0] as unknown as [
      unknown,
      { input: { Bucket: string; Key: string } },
      { expiresIn: number },
    ]
    expect(command.input).toEqual({ Bucket: 'workspace-alpha-bucket', Key: OBJECT_NAME })
    expect(opts.expiresIn).toBeGreaterThan(0)
    expect(opts.expiresIn).toBeLessThanOrEqual(600)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(PRESIGNED_URL)
    expect(mockSend).not.toHaveBeenCalled()

    expect(contentType).toBe('image/jpeg')
    expect(new Uint8Array(await new Response(body).arrayBuffer())).toEqual(bytes)
  })

  it('sends no Range header for a full read', async () => {
    const fetchMock = stubFetch(() => new Response(new Uint8Array([1]), { status: 200 }))

    await read()

    expect(fetchMock.mock.calls[0]![1]).toBeUndefined()
  })

  it('forwards a range as a Range header and maps the partial-content headers', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-length': '4',
            'content-range': 'bytes 0-3/100',
            'accept-ranges': 'bytes',
          },
        })
    )

    const result = await read('bytes=0-3')

    expect(fetchMock.mock.calls[0]![1]).toEqual({ headers: { Range: 'bytes=0-3' } })
    // The range goes on the request, not into the signed command.
    const [, command] = mockGetSignedUrl.mock.calls[0] as unknown as [
      unknown,
      { input: Record<string, unknown> },
    ]
    expect(command.input).not.toHaveProperty('Range')
    expect(result).toMatchObject({
      contentType: 'video/mp4',
      contentLength: 4,
      contentRange: 'bytes 0-3/100',
      acceptRanges: 'bytes',
    })
  })

  it('leaves absent length/range headers undefined', async () => {
    stubFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))

    const result = await read()

    expect(result.contentType).toBe('application/octet-stream')
    expect(result.contentRange).toBeUndefined()
    expect(result.acceptRanges).toBeUndefined()
  })

  it('reports a missing object as not found, shaped like the SDK error', async () => {
    stubFetch(() => new Response('<Error/>', { status: 404 }))

    const error = await read().catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(`S3 object not found: ${KEY}`)
    expect(error).toMatchObject({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } })
  })

  it('reports an unsatisfiable range the way the SDK does', async () => {
    stubFetch(() => new Response('<Error/>', { status: 416 }))

    await expect(read('bytes=500-600')).rejects.toMatchObject({
      name: 'InvalidRange',
      $metadata: { httpStatusCode: 416 },
    })
  })

  it('surfaces other S3 errors with the status code', async () => {
    stubFetch(() => new Response('<Error/>', { status: 403 }))

    const error = await read().catch((err: unknown) => err)

    expect((error as Error).message).toMatch(/HTTP 403/)
    expect(error).toMatchObject({ $metadata: { httpStatusCode: 403 } })
  })
})
