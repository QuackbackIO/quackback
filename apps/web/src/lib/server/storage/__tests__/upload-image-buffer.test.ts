import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { withWorkspace, workspaceIdFor } from '@/lib/server/__tests__/workspace-scope'

const captures = vi.hoisted(() => ({
  commands: [] as { Bucket: string; Key: string; Body: Buffer; ContentType: string }[],
  credentials: [] as { accessKeyId: string; secretAccessKey: string }[],
}))
vi.mock('@/lib/server/config', () => ({
  config: {
    s3Bucket: 'env-bucket',
    s3Region: 'auto',
    s3AccessKeyId: 'env-key',
    s3SecretAccessKey: 'env-secret',
    baseUrl: 'https://example.com',
  },
}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(config: { credentials: { accessKeyId: string; secretAccessKey: string } }) {
      captures.credentials.push(config.credentials)
    }
    async send(command: {
      input: { Bucket: string; Key: string; Body: Buffer; ContentType: string }
    }) {
      if (!command.input.Bucket || !command.input.Key || !Buffer.isBuffer(command.input.Body))
        throw new Error('Invalid PutObject arguments')
      captures.commands.push(command.input)
      return {}
    }
    destroy() {}
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
}))
import { uploadImageBuffer } from '../s3'
beforeEach(() => {
  captures.commands.length = 0
  captures.credentials.length = 0
})
it('returns the relative key while writing exact bytes to the current workspace namespace', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const expected = 'logos/' + createHash('sha256').update(bytes).digest('hex') + '.png'
  const result = await withWorkspace('acme-branding', () =>
    uploadImageBuffer(bytes, 'image/png', 'logos', { contentAddressed: true })
  )
  expect(result).toEqual({ key: expected, url: '/api/storage/' + expected })
  expect(captures.commands).toEqual([
    {
      Bucket: 'acme-branding-bucket',
      Key: 'w/' + workspaceIdFor('acme-branding') + '/' + expected,
      Body: bytes,
      ContentType: 'image/png',
    },
  ])
  expect(captures.credentials[0].accessKeyId).toBe('AK-acme-branding')
  const otherBytes = Buffer.concat([bytes, Buffer.from('different')])
  const other = await withWorkspace('acme-branding-second', () =>
    uploadImageBuffer(otherBytes, 'image/png', 'logos', { contentAddressed: true })
  )
  expect(other.key).not.toBe(result.key)
  expect(captures.commands[1].Key).toContain(String(workspaceIdFor('acme-branding-second')))
  expect(captures.commands[1].Body).toEqual(otherBytes)
})
it('refuses invalid MIME and empty bytes before issuing an upload', async () => {
  for (const [bytes, mime] of [
    [Buffer.from('x'), 'text/html'],
    [Buffer.alloc(0), 'image/png'],
  ] as const)
    await expect(
      withWorkspace('acme-branding', () =>
        uploadImageBuffer(bytes, mime, 'logos', { contentAddressed: true })
      )
    ).rejects.toThrow()
  expect(captures.commands).toHaveLength(0)
})
