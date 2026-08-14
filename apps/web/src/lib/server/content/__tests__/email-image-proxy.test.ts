import { describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://env-app.example.net', s3PublicUrl: undefined },
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

    expect(rewritten.content?.[0]?.attrs?.src).toBe(
      'https://ws-abc123.quackback.co.uk/api/storage/chat-images/a.png?email=1'
    )
  })

  it('leaves a foreign CDN src untouched', () => {
    const rewritten = withEmailProxyHint(
      doc([{ type: 'resizableImage', attrs: { src: 'https://cdn.example.com/b.png' } }])
    )
    expect(rewritten.content?.[0]?.attrs?.src).toBe('https://cdn.example.com/b.png')
  })
})
