// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
const localConfig = vi.hoisted(() => ({
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
  s3Region: process.env.S3_REGION ?? 'auto',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  baseUrl: 'https://example.com',
}))
vi.mock('@/lib/server/config', () => ({ config: localConfig }))
import { config } from '@/lib/server/config'
import { withWorkspace } from '@/lib/server/__tests__/workspace-scope'
import { uploadImageBuffer, getS3Object, deleteObject } from '../s3'
const localStorage = Boolean(
  config.s3Endpoint &&
  ['localhost', '127.0.0.1'].includes(new URL(config.s3Endpoint).hostname) &&
  config.s3Bucket &&
  config.s3AccessKeyId &&
  config.s3SecretAccessKey
)
it.skipIf(!localStorage)(
  'round trips a unique branding object through real local storage',
  async () => {
    const identity = 'acme-branding-' + randomUUID()
    const png = Buffer.concat([
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        'base64'
      ),
      Buffer.from(identity),
    ])
    await withWorkspace(
      identity,
      async () => {
        const result = await uploadImageBuffer(png, 'image/png', 'logos', {
          contentAddressed: true,
        })
        try {
          expect(result.key).toMatch(/^logos\/[a-f0-9]{64}\.png$/)
          expect(result.url).toBe('/api/storage/' + result.key)
          const stored = await getS3Object(result.key)
          expect(stored.contentType).toBe('image/png')
          expect(Buffer.from(await new Response(stored.body).arrayBuffer())).toEqual(png)
        } finally {
          await deleteObject(result.key)
        }
      },
      {
        storage: {
          bucket: config.s3Bucket!,
          endpoint: config.s3Endpoint,
          region: config.s3Region,
          forcePathStyle: config.s3ForcePathStyle,
        },
        secrets: {
          storage: {
            accessKeyId: config.s3AccessKeyId!,
            secretAccessKey: config.s3SecretAccessKey!,
          },
        },
      }
    )
  },
  30_000
)
