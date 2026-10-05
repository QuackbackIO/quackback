/**
 * The relocation against a real S3-compatible server. Opt-in: set
 * `STORAGE_RELOCATION_S3_TEST=1` with the local Silo (or any S3 endpoint) at
 * `S3_TEST_ENDPOINT` (default http://localhost:9000). It creates and removes a
 * throwaway bucket of its own and never touches the configured one.
 *
 * What the in-memory double cannot prove: that the CopySource encoding, the
 * `MetadataDirective`, and ListObjectsV2 pagination mean what the code assumes
 * to a real server.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as sdk from '@aws-sdk/client-s3'

/*
 * The SDK barrel only partially resolves under bundler module resolution (see
 * the header of `s3.ts`), so the surface this test drives is declared here.
 */
type Command = { readonly input: unknown }
interface S3Response {
  Contents?: Array<{ Key?: string }>
  IsTruncated?: boolean
  NextContinuationToken?: string
  ContentType?: string
  Metadata?: Record<string, string>
  Body?: { transformToString(): Promise<string> }
}
type Ctor = new (input: Record<string, unknown>) => Command
interface Sdk {
  S3Client: new (config: Record<string, unknown>) => {
    send(command: Command): Promise<S3Response>
    destroy(): void
  }
  CreateBucketCommand: Ctor
  DeleteBucketCommand: Ctor
  DeleteObjectCommand: Ctor
  GetObjectCommand: Ctor
  HeadObjectCommand: Ctor
  ListObjectsV2Command: Ctor
  PutObjectCommand: Ctor
}
const {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = sdk as unknown as Sdk

const enabled = process.env.STORAGE_RELOCATION_S3_TEST === '1'
const endpoint = process.env.S3_TEST_ENDPOINT ?? 'http://localhost:9000'
const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID ?? 'minioadmin'
const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'minioadmin'
const BUCKET = `qb-relocation-test-${randomUUID().slice(0, 8)}`
const WORKSPACE_ID = 'workspace_01kzf9848he8h86ct48hanask6'
const NS = `w/${WORKSPACE_ID}/`

vi.mock('@/lib/server/config', () => ({
  config: {
    s3Bucket: BUCKET,
    s3Region: 'us-east-1',
    s3Endpoint: endpoint,
    s3AccessKeyId: accessKeyId,
    s3SecretAccessKey: secretAccessKey,
    s3ForcePathStyle: true,
    baseUrl: 'https://feedback.example.com',
    isPooledTenancy: false,
  },
}))
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: async () => ({ id: WORKSPACE_ID }) } } },
}))
const kv = new Map<string, unknown>()
vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: async (key: string) => kv.get(key) ?? null,
  kvSet: async (key: string, value: unknown) => void kv.set(key, value),
}))
vi.mock('@/lib/server/sweep-lock', () => ({
  withSweepLock: async (_n: string, _t: number, fn: () => Promise<void>) => fn(),
}))

const client = new S3Client({
  region: 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
})

async function allKeys(): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token })
    )
    for (const o of page.Contents ?? []) if (o.Key) keys.push(o.Key)
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return keys
}

describe.skipIf(!enabled)('legacy relocation against a real S3 server', () => {
  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }))
  })

  afterAll(async () => {
    for (const Key of await allKeys()) {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key }))
    }
    await client.send(new DeleteBucketCommand({ Bucket: BUCKET }))
    client.destroy()
  })

  it('copies bare objects with their content type and keeps the originals', async () => {
    const bare = [
      'logos/brand.png',
      'attachments/2025/a file+with spaces&odd=chars.pdf',
      ...Array.from({ length: 1005 }, (_, i) => `post-images/p${i}.png`),
    ]
    for (const Key of bare.slice(0, 2)) {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key,
          Body: `bytes:${Key}`,
          ContentType: Key.endsWith('.pdf') ? 'application/pdf' : 'image/png',
          Metadata: { origin: 'legacy' },
        })
      )
    }
    await Promise.all(
      bare
        .slice(2)
        .map((Key) => client.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: Key })))
    )
    await client.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: `${NS}avatars/new.png`, Body: 'new' })
    )

    const { runLegacyStorageRelocation } = await import('../legacy-relocation')
    const outcome = await runLegacyStorageRelocation()

    expect(outcome.status).toBe('reconciling')
    const keys = new Set(await allKeys())
    for (const key of bare) {
      expect(keys.has(key)).toBe(true)
      expect(keys.has(`${NS}${key}`)).toBe(true)
    }
    expect([...keys].some((k) => k.startsWith(`${NS}w/`))).toBe(false)

    const pdf = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `${NS}${bare[1]}` }))
    expect(pdf.ContentType).toBe('application/pdf')
    expect(pdf.Metadata).toMatchObject({ origin: 'legacy' })
    const body = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${NS}${bare[1]}` }))
    expect(await body.Body?.transformToString()).toBe(`bytes:${bare[1]}`)

    // A second pass finds every destination present and copies nothing.
    kv.clear()
    const again = await runLegacyStorageRelocation()
    expect('marker' in again && again.marker).toMatchObject({
      copied: 0,
      alreadyPresent: bare.length,
    })
  }, 120_000)
})
