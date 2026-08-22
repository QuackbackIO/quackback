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
    s3PublicUrl: undefined,
    s3Proxy: false,
    baseUrl: 'https://env-app.example.net',
  },
}))

const { withEmailProxyHint } = await import('../email-image-proxy')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

function doc(nodes: JSONContent[]): JSONContent {
  return { type: 'doc', content: nodes }
}

describe('withEmailProxyHint', () => {
  it('absolutizes relative storage srcs from the system host and adds ?email=1', () => {
    const rewritten = withWorkspace(
      'workspace-alpha',
      () =>
        withEmailProxyHint(
          doc([
            { type: 'image', attrs: { src: '/api/storage/changelog-images/a.png', alt: 'Shot' } },
          ])
        ),
      {
        storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
        baseUrl: 'https://acme.quackback.co.uk',
      }
    )

    expect(rewritten.content?.[0]?.attrs?.src).toBe(
      'https://ws-abc123.quackback.co.uk/api/storage/changelog-images/a.png?email=1'
    )
  })

  it('rewrites a legacy friendly-host storage src onto the system host', () => {
    const rewritten = withWorkspace(
      'workspace-alpha',
      () =>
        withEmailProxyHint(
          doc([
            {
              type: 'chatImage',
              attrs: { src: 'https://acme.quackback.co.uk/api/storage/chat-images/a.png' },
            },
          ])
        ),
      {
        storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
        baseUrl: 'https://acme.quackback.co.uk',
      }
    )

    const src = rewritten.content?.[0]?.attrs?.src as string
    expect(
      src.startsWith('https://ws-abc123.quackback.co.uk/api/storage/chat-images/a.png?read=')
    ).toBe(true)
    expect(src).toContain('email=1')
  })

  it('mints a current read token on a private storage src before tagging email', () => {
    const rewritten = withWorkspace(
      'workspace-alpha',
      () =>
        withEmailProxyHint(
          doc([
            {
              type: 'image',
              attrs: { src: 'https://old.example.com/api/storage/uploads/2026/07/logo.png' },
            },
          ])
        ),
      {
        storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
        baseUrl: 'https://acme.quackback.co.uk',
        secrets: { storage: { accessKeyId: 'shared-key', secretAccessKey: 'shared-secret' } },
      }
    )

    const src = rewritten.content?.[0]?.attrs?.src as string
    expect(
      src.startsWith('https://ws-abc123.quackback.co.uk/api/storage/uploads/2026/07/logo.png?read=')
    ).toBe(true)
    expect(src).toContain('email=1')
  })

  it('leaves a foreign CDN src untouched', () => {
    const rewritten = withEmailProxyHint(
      doc([{ type: 'resizableImage', attrs: { src: 'https://cdn.example.com/b.png' } }])
    )
    expect(rewritten.content?.[0]?.attrs?.src).toBe('https://cdn.example.com/b.png')
  })
})
