import { describe, expect, it } from 'vitest'
import { cn } from '../cn'

describe('cn', () => {
  it('keeps the custom font sizes beside a text colour', () => {
    expect(cn('text-ui text-muted-foreground')).toBe('text-ui text-muted-foreground')
    expect(cn('text-2xs text-primary')).toBe('text-2xs text-primary')
  })

  it('lets a later font size win over a custom one', () => {
    expect(cn('text-ui', 'text-xs')).toBe('text-xs')
    expect(cn('text-sm', 'text-2xs')).toBe('text-2xs')
  })
})
