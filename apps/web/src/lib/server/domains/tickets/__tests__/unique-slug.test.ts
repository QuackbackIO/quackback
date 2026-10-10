import { describe, expect, it } from 'vitest'
import { nextUniqueSlug, toUnderscoreSlug } from '../unique-slug'

describe('toUnderscoreSlug', () => {
  it('rewrites hyphenated slugify output to underscores', () => {
    expect(toUnderscoreSlug('In Progress')).toBe('in_progress')
    expect(toUnderscoreSlug('Waiting on Customer')).toBe('waiting_on_customer')
  })
})

describe('nextUniqueSlug', () => {
  it('returns the base when free', () => {
    expect(nextUniqueSlug('open', new Set())).toBe('open')
  })

  it('increments _2, _3, … past taken values', () => {
    expect(nextUniqueSlug('open', new Set(['open']))).toBe('open_2')
    expect(nextUniqueSlug('open', new Set(['open', 'open_2']))).toBe('open_3')
  })
})
