import { describe, it, expect } from 'vitest'
import { createPublicPostSchema, tiptapContentSchema } from '../posts'

describe('tiptapContentSchema', () => {
  it('accepts link marks with null title attribute', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Check out ' },
            {
              type: 'text',
              text: 'https://example.com',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                    title: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = tiptapContentSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('accepts link marks without optional attrs', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a link',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://example.com' },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = tiptapContentSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects mark attrs with non-primitive values', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bad',
              marks: [
                {
                  type: 'bold',
                  attrs: { evil: { nested: 'object' } },
                },
              ],
            },
          ],
        },
      ],
    }
    const result = tiptapContentSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('createPublicPostSchema metadata', () => {
  const post = (metadata: Record<string, string>) =>
    createPublicPostSchema.parse({ boardId: 'board_x', title: 'T', metadata }).metadata

  it('keeps ordinary session context as sent', () => {
    expect(post({ plan: 'pro', page: 'https://example.com/settings' })).toEqual({
      plan: 'pro',
      page: 'https://example.com/settings',
    })
  })

  it('keeps the first 50 keys and drops the rest, without refusing the post', () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v']))
    const kept = post(many)!
    expect(Object.keys(kept)).toHaveLength(50)
    expect(kept.k0).toBe('v')
    expect(kept.k50).toBeUndefined()
  })

  it('drops a key over 100 characters or a value over 1,000, keeping the others', () => {
    expect(post({ ['k'.repeat(101)]: 'v', ok: 'yes' })).toEqual({ ok: 'yes' })
    expect(post({ long: 'v'.repeat(1001), ok: 'yes' })).toEqual({ ok: 'yes' })
    expect(post({ ['k'.repeat(100)]: 'v'.repeat(1000) })).toEqual({
      ['k'.repeat(100)]: 'v'.repeat(1000),
    })
  })

  it('stores nothing oversized from the crafted 400 KB payload', () => {
    const heavy = Object.fromEntries(
      Array.from({ length: 2000 }, (_, i) => [`k${i}`, 'v'.repeat(200)])
    )
    const kept = post(heavy)!
    expect(Object.keys(kept)).toHaveLength(50)
    expect(JSON.stringify(kept).length).toBeLessThan(50 * (100 + 1000 + 10))
  })
})
