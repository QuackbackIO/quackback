/**
 * Per-locale widget copy overrides: exact-locale match, base-language fallback
 * (de-AT -> de), and empty when nothing matches (callers fall back to base).
 */
import { describe, it, expect } from 'vitest'
import { widgetTranslationFor } from '../translations'

const T = {
  de: { welcomeMessage: 'Hallo', greeting: 'Willkommen' },
  'fr-CA': { welcomeMessage: 'Bonjour' },
}

describe('widgetTranslationFor', () => {
  it('returns the exact-locale overrides', () => {
    expect(widgetTranslationFor(T, 'de').welcomeMessage).toBe('Hallo')
    expect(widgetTranslationFor(T, 'fr-CA').welcomeMessage).toBe('Bonjour')
  })

  it('falls back from a regional locale to its base language', () => {
    expect(widgetTranslationFor(T, 'de-AT').greeting).toBe('Willkommen')
  })

  it('returns empty when no locale, no map, or no match', () => {
    expect(widgetTranslationFor(T, 'es')).toEqual({})
    expect(widgetTranslationFor(T, undefined)).toEqual({})
    expect(widgetTranslationFor(undefined, 'de')).toEqual({})
  })

  it('prefers an exact regional match over the base language', () => {
    const t = { fr: { welcomeMessage: 'base-fr' }, 'fr-CA': { welcomeMessage: 'quebec' } }
    expect(widgetTranslationFor(t, 'fr-CA').welcomeMessage).toBe('quebec')
  })
})
