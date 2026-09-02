import { describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'

vi.mock('@/lib/server/config', () => ({
  config: {
    s3Bucket: 'env-bucket',
    s3Region: 'env-region',
    s3Endpoint: 'https://env-endpoint.example.net',
    s3AccessKeyId: 'env-access-key',
    s3SecretAccessKey: 'env-secret-key',
    s3ForcePathStyle: true,
    s3PublicUrl: 'https://env-cdn.example.net',
    s3Proxy: false,
    baseUrl: 'https://env-app.example.net',
  },
}))

const { withCurrentStorageReadTokens } = await import('../storage-read-urls')
const { getPublicUrlOrNull } = await import('@/lib/server/storage/s3')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

const PRIVATE = 'uploads/2026/07/b260d4f8-nexus-logo.png'
const SHARED_SECRET = {
  storage: { accessKeyId: 'shared-key', secretAccessKey: 'shared-secret' },
} as const

function doc(nodes: JSONContent[]): JSONContent {
  return { type: 'doc', content: nodes }
}

describe('withCurrentStorageReadTokens', () => {
  it('mints a current read token on an unsigned private welcome-card image', () => {
    const rewritten = withWorkspace(
      'workspace-alpha',
      () =>
        withCurrentStorageReadTokens(
          doc([
            {
              type: 'image',
              attrs: {
                src: `https://old.example.com/api/storage/${PRIVATE}`,
                alt: '',
                width: 100,
                height: 100,
              },
            },
          ])
        ),
      { secrets: SHARED_SECRET }
    )

    const minted = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PRIVATE), {
      secrets: SHARED_SECRET,
    })
    expect(rewritten.content?.[0]?.attrs?.src).toBe(minted)
  })

  it('does not mutate the input tree', () => {
    const input = doc([
      {
        type: 'image',
        attrs: { src: `https://old.example.com/api/storage/${PRIVATE}` },
      },
    ])
    const before = JSON.stringify(input)
    withWorkspace('workspace-alpha', () => withCurrentStorageReadTokens(input), {
      secrets: SHARED_SECRET,
    })
    expect(JSON.stringify(input)).toBe(before)
  })

  it('contentJsonForClient passes null through and remints a stored doc', async () => {
    const { contentJsonForClient } = await import('../storage-read-urls')
    expect(contentJsonForClient(null)).toBeNull()
    const rewritten = withWorkspace(
      'workspace-alpha',
      () =>
        contentJsonForClient(
          doc([
            {
              type: 'image',
              attrs: { src: `https://old.example.com/api/storage/${PRIVATE}` },
            },
          ])
        ),
      { secrets: SHARED_SECRET }
    )
    const minted = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PRIVATE), {
      secrets: SHARED_SECRET,
    })
    expect(rewritten?.content?.[0]?.attrs?.src).toBe(minted)
  })

  it('leaves a foreign CDN src untouched', () => {
    const rewritten = withCurrentStorageReadTokens(
      doc([{ type: 'image', attrs: { src: 'https://cdn.example.com/b.png' } }])
    )
    expect(rewritten.content?.[0]?.attrs?.src).toBe('https://cdn.example.com/b.png')
  })

  it('leaves an unsigned public portal-images src unsigned', () => {
    const src = 'https://feedback.example.com/api/storage/portal-images/2026/04/shot.png'
    const rewritten = withCurrentStorageReadTokens(doc([{ type: 'image', attrs: { src } }]))
    expect(rewritten.content?.[0]?.attrs?.src).toBe('/api/storage/portal-images/2026/04/shot.png')
  })
})
