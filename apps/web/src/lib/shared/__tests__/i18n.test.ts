import { describe, it, expect } from 'vitest'
import {
  normalizeLocale,
  resolveLocale,
  isRtlLocale,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from '../i18n'

describe('normalizeLocale', () => {
  it('returns exact match for supported locale', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('de')).toBe('de')
  })
  it('strips region to find base locale', () => {
    expect(normalizeLocale('fr-FR')).toBe('fr')
    expect(normalizeLocale('pt-BR')).toBe('pt')
    expect(normalizeLocale('de-AT')).toBe('de')
  })
  it('returns null for unsupported locale', () => {
    expect(normalizeLocale('zz')).toBeNull()
    expect(normalizeLocale('xx-YY')).toBeNull()
  })
  it('handles case insensitivity', () => {
    expect(normalizeLocale('EN')).toBe('en')
    expect(normalizeLocale('FR-fr')).toBe('fr')
  })
  it('returns null for empty or invalid input', () => {
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale('not-a-locale-at-all')).toBeNull()
  })
})

describe('resolveLocale', () => {
  it('returns first supported locale from Accept-Language header', () => {
    expect(resolveLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr')
    expect(resolveLocale('de,en;q=0.5')).toBe('de')
  })
  it('falls back to default when no supported locale found', () => {
    expect(resolveLocale('zz,xx;q=0.5')).toBe('en')
    expect(resolveLocale('')).toBe('en')
    expect(resolveLocale(null)).toBe('en')
  })
  it('respects quality weights', () => {
    expect(resolveLocale('en;q=0.5,de;q=0.9')).toBe('de')
  })
  it('returns explicit locale when provided', () => {
    expect(resolveLocale('de,en;q=0.5', 'fr')).toBe('fr')
  })
  it('falls back to header when explicit locale is unsupported', () => {
    expect(resolveLocale('de,en;q=0.5', 'zz')).toBe('de')
  })
})

describe('isRtlLocale', () => {
  it('returns true for RTL locales', () => {
    expect(isRtlLocale('ar')).toBe(true)
    expect(isRtlLocale('he')).toBe(true)
    expect(isRtlLocale('fa')).toBe(true)
    expect(isRtlLocale('ur')).toBe(true)
  })
  it('returns false for LTR locales', () => {
    expect(isRtlLocale('en')).toBe(false)
    expect(isRtlLocale('fr')).toBe(false)
    expect(isRtlLocale('de')).toBe(false)
  })
})

describe('SUPPORTED_LOCALES', () => {
  it('includes en as default', () => {
    expect(SUPPORTED_LOCALES).toContain('en')
  })
  it('DEFAULT_LOCALE is en', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })
})
