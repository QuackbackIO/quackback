import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: () => 'https://acme.example',
}))

import { contentHoldReason } from '../content-holds'
import type { TiptapContent } from '@/lib/shared/db-types'

const imageDoc = {
  type: 'doc',
  content: [{ type: 'image', attrs: { src: 'https://cdn.example.com/x.png' } }],
} as TiptapContent

const linkDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'click',
          marks: [{ type: 'link', attrs: { href: 'https://evil.example' } }],
        },
      ],
    },
  ],
} as TiptapContent

const textDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
} as TiptapContent

describe('contentHoldReason', () => {
  it('returns null when flags are off', () => {
    expect(contentHoldReason({ holdImages: false, holdLinks: false }, imageDoc)).toBeNull()
  })

  it('holds images when holdImages is on', () => {
    expect(contentHoldReason({ holdImages: true }, imageDoc)).toBe('images')
    expect(contentHoldReason({ holdImages: true }, textDoc)).toBeNull()
  })

  it('holds links when holdLinks is on', () => {
    expect(contentHoldReason({ holdLinks: true }, linkDoc)).toBe('links')
    expect(contentHoldReason({ holdLinks: true }, textDoc)).toBeNull()
  })

  it('returns images+links when both match', () => {
    const both = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://cdn.example.com/x.png' } },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'https://evil.example' } }],
            },
          ],
        },
      ],
    } as TiptapContent
    expect(contentHoldReason({ holdImages: true, holdLinks: true }, both)).toBe('images+links')
  })
})
