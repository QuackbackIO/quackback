/**
 * Links to private-prefix files written before read tokens and the workspace
 * namespace existed carry no `?read=` token: they sit in already-sent emails,
 * on external pages and in API clients' stores, and nothing can re-sign them.
 * On a single-workspace install the route serves such a file token-less when
 * its bare original is still in the bucket. Everything else still needs the
 * token: a new upload (which has no bare original), pooled tenancy (where a
 * bare key is nobody's), and every spelling of a key that tries to borrow
 * somebody else's original.
 *
 * Driven through the real route, signer and storage module; only the SDK is an
 * in-memory bucket, and it answers per object name, so a check against the
 * wrong name fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const WORKSPACE_ID = 'workspace_01kzf9848he8h86ct48hanask6'
const NS = `w/${WORKSPACE_ID}/`

const mockConfig = vi.hoisted(() => ({
  s3Bucket: 'self-hosted-bucket',
  s3Region: 'us-east-1',
  s3Endpoint: undefined as string | undefined,
  s3AccessKeyId: 'env-access-key',
  s3SecretAccessKey: 'fixture-secret',
  s3ForcePathStyle: true,
  s3PublicUrl: undefined as string | undefined,
  s3Proxy: true,
  baseUrl: 'https://feedback.example.com',
  isPooledTenancy: false,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: async () => ({ id: WORKSPACE_ID }) } } },
}))

/** The bucket: object name → bytes. */
const objects = vi.hoisted(() => new Map<string, Uint8Array<ArrayBuffer>>())
/** Every command the route sent, by kind and object name. */
const sent = vi.hoisted(() => [] as Array<{ kind: string; Key: string }>)

vi.mock('@aws-sdk/client-s3', () => {
  const command = (kind: string) =>
    vi.fn(function (input: { Key: string }) {
      return { kind, input }
    })
  const notFound = () =>
    Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
  return {
    S3Client: vi.fn(function () {
      return {
        send: async (cmd: { kind: string; input: { Key: string } }) => {
          sent.push({ kind: cmd.kind, Key: cmd.input.Key })
          const body = objects.get(cmd.input.Key)
          if (cmd.kind === 'head') {
            if (!body) throw notFound()
            return { ContentLength: body.byteLength }
          }
          if (cmd.kind === 'get') {
            if (!body) throw Object.assign(notFound(), { name: 'NoSuchKey' })
            return {
              Body: { transformToWebStream: () => new Blob([body]).stream() },
              ContentType: 'image/png',
              ContentLength: body.byteLength,
            }
          }
          return {}
        },
        destroy: vi.fn(),
      }
    }),
    GetObjectCommand: command('get'),
    HeadObjectCommand: command('head'),
    PutObjectCommand: command('put'),
    DeleteObjectCommand: command('delete'),
    ListObjectsV2Command: command('list'),
    CopyObjectCommand: command('copy'),
  }
})
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://bucket.example.com/presigned'),
}))

const { handleStorageGet } = await import('../$')
const { getPublicUrlOrNull } = await import('@/lib/server/storage/s3')

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
let n = 0
/** A fresh key per test, so no answer is served from a previous test's cache. */
const freshKey = (prefix: string) =>
  `${prefix}/2025/06/${++n}a1b2c3d4-0000-4000-8000-000000000000-image.png`

/** An object written before the namespace: the bare original plus the relocated copy. */
function seedLegacy(key: string): void {
  objects.set(key, PNG)
  objects.set(`${NS}${key}`, PNG)
}

const get = (path: string) =>
  handleStorageGet({ request: new Request(`https://feedback.example.com${path}`) })
const heads = () => sent.filter((c) => c.kind === 'head')

beforeEach(() => {
  objects.clear()
  sent.length = 0
  mockConfig.isPooledTenancy = false
  delete process.env.QUACKBACK_TENANCY
})

afterEach(() => {
  delete process.env.QUACKBACK_TENANCY
})

describe('a link from before read tokens, on a single-workspace install', () => {
  it.each(['uploads', 'chat-images', 'widget-images'])(
    'serves a %s/ file whose bare original is still in the bucket without a token',
    async (prefix) => {
      const key = freshKey(prefix)
      seedLegacy(key)

      const res = await get(`/api/storage/${key}`)

      expect(res.status).toBe(200)
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
      // The check names the bare original; the bytes come from the namespaced copy.
      expect(heads().map((c) => c.Key)).toEqual([key])
      expect(sent.find((c) => c.kind === 'get')?.Key).toBe(`${NS}${key}`)
      expect(res.headers.get('Cache-Control')).toMatch(/^private,/)
    }
  )

  it('answers a repeat from memory rather than asking the bucket again', async () => {
    const key = freshKey('chat-images')
    seedLegacy(key)

    await get(`/api/storage/${key}`)
    await get(`/api/storage/${key}?email=1`)

    expect(heads()).toHaveLength(1)
  })

  it('still serves a valid token as before, without consulting the bucket root', async () => {
    const key = freshKey('chat-images')
    objects.set(`${NS}${key}`, PNG)

    const res = await get(getPublicUrlOrNull(key)!)

    expect(res.status).toBe(200)
    expect(heads()).toHaveLength(0)
  })
})

describe('everything else still needs the token', () => {
  it('refuses a new private upload, which has no bare original', async () => {
    const key = freshKey('chat-images')
    objects.set(`${NS}${key}`, PNG)

    const res = await get(`/api/storage/${key}`)

    expect(res.status).toBe(403)
    expect(sent.filter((c) => c.kind === 'get')).toHaveLength(0)
  })

  it('refuses a wrong token even when the bare original exists', async () => {
    const key = freshKey('uploads')
    seedLegacy(key)

    const res = await get(`/api/storage/${key}?read=${'0'.repeat(32)}`)

    expect(res.status).toBe(403)
  })

  it('refuses a private prefix nothing wrote before tokens, even with a bare original', async () => {
    for (const key of [
      'attachments/2025/06/contract.pdf',
      'exports/export_run_01h455vb4pex5vsknk084sn02q.zip',
      'files/2025/06/report.pdf',
    ]) {
      seedLegacy(key)
      const res = await get(`/api/storage/${key}`)
      expect(res.status, key).toBe(403)
    }
    expect(heads()).toHaveLength(0)
  })

  it('never allows it under pooled tenancy, where a bare key is nobody’s', async () => {
    process.env.QUACKBACK_TENANCY = 'pooled'
    mockConfig.isPooledTenancy = true
    const key = freshKey('chat-images')
    seedLegacy(key)

    const res = await get(`/api/storage/${key}`)

    expect(res.status).toBe(403)
    expect(heads()).toHaveLength(0)
  })

  it('never allows it inside a workspace scope', async () => {
    const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')
    const { isPreNamespaceObject } = await import('@/lib/server/storage/s3')
    const key = freshKey('chat-images')
    seedLegacy(key)

    const allowed = await withWorkspace('workspace-alpha', () => isPreNamespaceObject(key))

    expect(allowed).toBe(false)
    expect(heads()).toHaveLength(0)
  })
})

describe('no spelling of a key borrows another object’s original', () => {
  it('refuses a key inside some workspace namespace, even when that object exists', async () => {
    const other = 'workspace_01kxddf1jaf6cr22gerxt7z9gg'
    const inner = freshKey('chat-images')
    // Another workspace's object, and this workspace's own new upload: both are
    // objects at the names a bare-key check would look up.
    objects.set(`w/${other}/${inner}`, PNG)
    objects.set(`${NS}w/${other}/${inner}`, PNG)
    objects.set(`${NS}${inner}`, PNG)
    objects.set(`${NS}${NS}${inner}`, PNG)

    for (const key of [`w/${other}/${inner}`, `${NS}${inner}`]) {
      const res = await get(`/api/storage/${key}`)
      expect(res.status, key).toBe(403)
    }
    expect(heads()).toHaveLength(0)
  })

  it('refuses traversal, encoded traversal and encoded separators', async () => {
    const victim = 'attachments/2025/06/contract.pdf'
    seedLegacy(victim)
    const base = freshKey('uploads')
    seedLegacy(base)

    for (const path of [
      `/api/storage/uploads/../${victim}`,
      `/api/storage/uploads/%2e%2e/${victim}`,
      `/api/storage/uploads%2F..%2F${victim}`,
      `/api/storage/uploads/%252e%252e/${victim}`,
      `/api/storage/uploads//${victim}`,
      `/api/storage/uploads/./${victim}`,
      `/api/storage/uploads%5C..%5C${victim}`,
    ]) {
      const res = await get(path)
      expect([400, 403], path).toContain(res.status)
    }
    expect(sent.filter((c) => c.kind === 'get')).toHaveLength(0)
    // Only canonical keys under a legacy prefix ever reach the bucket root.
    for (const head of heads()) expect(head.Key.startsWith('uploads/')).toBe(true)
    expect(heads().filter((h) => /\.\.|\/\/|\/\.\/|%|\\/.test(h.Key))).toEqual([])
  })
})
