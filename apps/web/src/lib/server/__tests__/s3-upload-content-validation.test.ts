/**
 * uploadImageFromFormData must validate file CONTENT, not just the declared
 * multipart Content-Type — the type label is caller-controlled, and the bytes
 * are stored and served back under that label. A mismatch (or unsniffable
 * bytes) is rejected before anything reaches storage, mirroring the magic-byte
 * check the unfurl image proxy already applies to fetched images.
 */
import { describe, expect, it, vi } from 'vitest'

const mockConfig = {
  s3Bucket: 'my-bucket',
  s3Region: 'us-east-1',
  s3AccessKeyId: 'access-key',
  s3SecretAccessKey: 'secret-key',
  s3Endpoint: undefined as string | undefined,
  s3ForcePathStyle: false,
  s3PublicUrl: undefined as string | undefined,
  s3Proxy: false,
  baseUrl: 'https://app.example.com',
}

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

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

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://s3.amazonaws.com/presigned'),
}))

const { uploadImageFromFormData, uploadImageBuffer } = await import('@/lib/server/storage/s3')

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const GIF_BYTES = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0]))
const HTML_BYTES = new Uint8Array(
  [...'<html><script>alert(1)</script></html>'].map((c) => c.charCodeAt(0))
)

function formDataWith(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): FormData {
  const fd = new FormData()
  fd.append('file', new File([bytes], name, { type }))
  return fd
}

describe('uploadImageFromFormData — content validation', () => {
  it('accepts bytes that match the declared type', async () => {
    const res = await uploadImageFromFormData(formDataWith(PNG_BYTES, 'a.png', 'image/png'), 'p')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { publicUrl: string }
    expect(body.publicUrl).toContain('/api/storage/p/')
  })

  it('rejects non-image bytes declared as an allowed image type', async () => {
    mockSend.mockClear()
    const res = await uploadImageFromFormData(formDataWith(HTML_BYTES, 'a.png', 'image/png'), 'p')
    expect(res.status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects image bytes whose format differs from the declared type', async () => {
    mockSend.mockClear()
    const res = await uploadImageFromFormData(formDataWith(GIF_BYTES, 'a.png', 'image/png'), 'p')
    expect(res.status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects a body too short to identify', async () => {
    const res = await uploadImageFromFormData(
      formDataWith(new Uint8Array([0x89, 0x50]), 'a.png', 'image/png'),
      'p'
    )
    expect(res.status).toBe(400)
  })

  it('still rejects disallowed declared types before reading bytes', async () => {
    const res = await uploadImageFromFormData(
      formDataWith(PNG_BYTES, 'a.svg', 'image/svg+xml'),
      'p'
    )
    expect(res.status).toBe(400)
  })
})

describe('uploadImageBuffer — content-addressed keys', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
  const keyOf = (i: number) =>
    ((mockSend.mock.calls[i] as unknown[])[0] as { input: { Key: string } }).input.Key

  it('derives one stable key from identical bytes so duplicates collapse', async () => {
    mockSend.mockClear()
    await uploadImageBuffer(PNG, 'image/png', 'link-previews', { contentAddressed: true })
    await uploadImageBuffer(PNG, 'image/png', 'link-previews', { contentAddressed: true })
    expect(keyOf(0)).toBe(keyOf(1))
    expect(keyOf(0)).toMatch(/^link-previews\/[0-9a-f]{64}\.png$/)
  })

  it('uses a timestamped key by default', async () => {
    mockSend.mockClear()
    await uploadImageBuffer(PNG, 'image/png', 'link-previews')
    expect(keyOf(0)).toMatch(/rehost-\d+\.png$/)
  })
})
