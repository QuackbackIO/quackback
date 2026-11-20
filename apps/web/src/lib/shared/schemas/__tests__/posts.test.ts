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
    createPublicPostSchema.safeParse({ boardId: 'board_x', title: 'T', metadata })

  it('accepts ordinary session context', () => {
    expect(post({ plan: 'pro', page: 'https://example.com/settings' }).success).toBe(true)
  })

  it('refuses more than 50 keys', () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v']))
    expect(post(many).success).toBe(false)
  })

  it('refuses a long key or a long value', () => {
    expect(post({ ['k'.repeat(101)]: 'v' }).success).toBe(false)
    expect(post({ k: 'v'.repeat(1001) }).success).toBe(false)
  })

  it('refuses the oversized payload a crafted request sends', () => {
    const heavy = Object.fromEntries(
      Array.from({ length: 2000 }, (_, i) => [`k${i}`, 'v'.repeat(200)])
    )
    expect(post(heavy).success).toBe(false)
  })
})
