import { afterEach, describe, expect, it, vi } from 'vitest'
import { nameInitial } from '../initial'

describe('nameInitial', () => {
  it.each([
    ['Acme', 'A'],
    ['acme', 'A'],
    ['  Acme', 'A'],
    ['42 Labs', '4'],
    ['日本語', '日'],
    ['!!Acme', 'A'],
    ['"quoted" name', 'Q'],
    ['(EU) Support', 'E'],
    ['éclair', 'É'],
    ['éclair', 'É'],
    ['ß', 'SS'],
  ])('takes the first letter or number of %j', (name, expected) => {
    expect(nameInitial(name)).toBe(expected)
  })

  it('keeps a whole emoji instead of half a surrogate pair', () => {
    expect(nameInitial('🦆 Fernhill')).toBe('🦆')
    expect(nameInitial('🦆')).toBe('🦆')
    expect(nameInitial('🦆').length).toBe(2)
  })

  it('keeps a ZWJ sequence and a skin tone together', () => {
    expect(nameInitial('👩‍👩‍👧 Family')).toBe('👩‍👩‍👧')
    expect(nameInitial('👍🏽 Nice')).toBe('👍🏽')
  })

  it('keeps a flag together', () => {
    expect(nameInitial('🇬🇧 Britain')).toBe('🇬🇧')
  })

  it('skips leading punctuation and spaces before an emoji', () => {
    expect(nameInitial('!! 🦆 Co')).toBe('🦆')
  })

  it('falls back to the first visible character when there is no letter', () => {
    expect(nameInitial('!!')).toBe('!')
    expect(nameInitial(' -- ')).toBe('-')
  })

  it('returns an empty string for nothing visible', () => {
    expect(nameInitial('')).toBe('')
    expect(nameInitial('   ')).toBe('')
    expect(nameInitial(null)).toBe('')
    expect(nameInitial(undefined)).toBe('')
  })
})

describe('nameInitial without Intl.Segmenter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('still never splits a character in half', async () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined })
    vi.resetModules()
    const { nameInitial: fallback } = await import('../initial')
    expect(fallback('🦆 Fernhill')).toBe('🦆')
    expect(fallback('!!Acme')).toBe('A')
    expect(fallback('')).toBe('')
  })
})
