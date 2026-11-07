/** Colours said by name, and reasons kept only when a person can read them. */
import { describe, expect, it } from 'vitest'
import { plainReason, plainWords } from '../colour-names'

describe('plainWords', () => {
  it('drops a code after a name and names a code alone', () => {
    expect(plainWords('pink (#fb556d) as the brand colour')).toBe('pink as the brand colour')
    expect(plainWords('Buttons now turn #000000 on hover.')).toBe(
      'Buttons now turn black on hover.'
    )
    expect(plainWords('The page is oklch(0.98 0.01 90).')).toBe('The page is white.')
  })
})

describe('plainReason', () => {
  it('keeps a plain reason and drops the builder’s own', () => {
    expect(plainReason('images are uploaded in the panel')).toBe('images are uploaded in the panel')
    expect(plainReason('Home has no block called x; its blocks are status_a1')).toBeNull()
    expect(
      plainReason('A tint background’s settings are written as JSON, such as {"a":1}')
    ).toBeNull()
    expect(plainReason('use a brand colour (accent, support)')).toBeNull()
  })
})
