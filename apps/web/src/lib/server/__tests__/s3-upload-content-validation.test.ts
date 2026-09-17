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

/**
 * The self-hosted install's own workspace. Storage composes every object name
 * from `settings.id`, which an unscoped process reads from the one database it
 * has — so these deployment-matrix cases need that read to answer.
 */
const LOCAL_WORKSPACE = 'workspace_01kzf9848he8h86ct48hanask6'
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: async () => ({ id: LOCAL_WORKSPACE }) } } },
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

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://s3.amazonaws.com/presigned'),
}))

const { uploadImageFromFormData, uploadMediaFromFormData, uploadImageBuffer } =
  await import('@/lib/server/storage/s3')

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const GIF_BYTES = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0]))
const HTML_BYTES = new Uint8Array(
  [...'<html><script>alert(1)</script></html>'].map((c) => c.charCodeAt(0))
)
const MOV_BYTES = new Uint8Array([
  0,
  0,
  0,
  0x18,
  ...'ftypqt  '.split('').map((c) => c.charCodeAt(0)),
  0,
  0,
  0,
  0,
])
const M4V_BYTES = new Uint8Array([
  0,
  0,
  0,
  0x18,
  ...'ftypM4V '.split('').map((c) => c.charCodeAt(0)),
  0,
  0,
  0,
  0,
])

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

describe('uploadMediaFromFormData — MOV and M4V containers', () => {
  const lastPutInput = () => {
    const calls = mockSend.mock.calls as unknown as Array<[{ input: { ContentType?: string } }]>
    return calls[calls.length - 1]![0].input
  }

  it('accepts a QuickTime MOV and preserves its content type', async () => {
    mockSend.mockClear()
    const res = await uploadMediaFromFormData(
      formDataWith(MOV_BYTES, 'recording.mov', 'video/quicktime'),
      'portal-media'
    )
    expect(res.status).toBe(200)
    expect(lastPutInput().ContentType).toBe('video/quicktime')
  })

  it('infers QuickTime for a MOV when the picker omits the MIME type', async () => {
    mockSend.mockClear()
    const res = await uploadMediaFromFormData(
      formDataWith(MOV_BYTES, 'recording.mov', ''),
      'portal-media'
    )
    expect(res.status).toBe(200)
    expect(lastPutInput().ContentType).toBe('video/quicktime')
  })

  it('accepts the common M4V MIME alias', async () => {
    mockSend.mockClear()
    const res = await uploadMediaFromFormData(
      formDataWith(M4V_BYTES, 'recording.m4v', 'video/x-m4v'),
      'portal-media'
    )
    expect(res.status).toBe(200)
    expect(lastPutInput().ContentType).toBe('video/x-m4v')
  })

  it('rejects non-video bytes declared as QuickTime', async () => {
    mockSend.mockClear()
    const res = await uploadMediaFromFormData(
      formDataWith(HTML_BYTES, 'recording.mov', 'video/quicktime'),
      'portal-media'
    )
    expect(res.status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
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
    // The stored key is still `link-previews/<sha256>.png` — content-addressing
    // is what makes duplicates collapse, and the namespace is a prefix composed
    // at the boundary rather than part of the key the hash produces.
    expect(keyOf(0)).toMatch(new RegExp(`^w/${LOCAL_WORKSPACE}/link-previews/[0-9a-f]{64}\\.png$`))
  })

  it('uses a timestamped key by default', async () => {
    mockSend.mockClear()
    await uploadImageBuffer(PNG, 'image/png', 'link-previews')
    expect(keyOf(0)).toMatch(/rehost-\d+\.png$/)
  })
})
