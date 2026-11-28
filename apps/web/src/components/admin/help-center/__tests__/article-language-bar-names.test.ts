import { describe, expect, it } from 'vitest'
import { LOCALE_NATIVE_NAMES } from '@/lib/shared/locale-names'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import { EDITOR_LANGUAGE_NAMES, languageName } from '../article-language-bar'

describe('editor language names', () => {
  it('names every product language as the shared names table does', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(languageName(locale)).toBe(LOCALE_NATIVE_NAMES[locale])
    }
    expect(Object.keys(EDITOR_LANGUAGE_NAMES).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('falls back to the code for a language the product does not name', () => {
    expect(languageName('xx')).toBe('xx')
  })
})
