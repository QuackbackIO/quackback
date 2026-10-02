import { describe, expect, it } from 'vitest'
import { INLINE_LINK } from '../inline-link'

describe('INLINE_LINK', () => {
  const tokens = INLINE_LINK.split(' ')

  it('is foreground text, never the low-contrast brand colour', () => {
    expect(tokens).toContain('text-foreground')
    expect(tokens.some((t) => /^(hover:)?text-(primary|accent-ink)/.test(t))).toBe(false)
  })

  it('is always underlined, with a muted underline that firms up on hover', () => {
    expect(tokens).toContain('underline')
    expect(tokens).toContain('decoration-foreground/30')
    expect(tokens).toContain('hover:decoration-foreground')
  })
})
