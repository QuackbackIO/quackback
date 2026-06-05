import { describe, it, expect } from 'vitest'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@/lib/shared/i18n'
import en from '../en.json'
import de from '../de.json'
import fr from '../fr.json'
import es from '../es.json'
import ar from '../ar.json'
import ru from '../ru.json'
import ptBr from '../pt-br.json'

const catalogs: Record<string, Record<string, string>> = {
  en,
  de,
  fr,
  es,
  ar,
  ru,
  'pt-br': ptBr,
}

const enKeys = Object.keys(en)
const localesToCheck = SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)

describe('locale catalogs', () => {
  it('has a catalog file for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(catalogs[locale], `missing catalog for "${locale}"`).toBeDefined()
    }
  })

  // A key present in en.json but absent from a locale falls back to the English
  // defaultMessage at runtime, surfacing untranslated strings to the user.
  it.each(localesToCheck)('%s defines every key present in en.json', (locale) => {
    const localeKeys = new Set(Object.keys(catalogs[locale]))
    const missing = enKeys.filter((key) => !localeKeys.has(key))
    expect(missing, `${locale}.json is missing ${missing.length} key(s)`).toEqual([])
  })

  // Extra keys are dead weight (and usually a sign a key was renamed in en.json
  // without updating the locale), so keep every catalog in lockstep with en.
  it.each(localesToCheck)('%s defines no keys absent from en.json', (locale) => {
    const enKeySet = new Set(enKeys)
    const extra = Object.keys(catalogs[locale]).filter((key) => !enKeySet.has(key))
    expect(extra, `${locale}.json has ${extra.length} stale key(s)`).toEqual([])
  })
})
