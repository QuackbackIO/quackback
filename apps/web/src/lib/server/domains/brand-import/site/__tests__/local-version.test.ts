/**
 * A homepage that is a country or language picker (ikea.com's) names its
 * local versions with hreflang links. Import reads the one for the admin's
 * own language instead, as their browser would have been sent there.
 */
import { describe, expect, it } from 'vitest'
import { acceptLanguages, localVersion } from '../local-version'

const versions = [
  { lang: 'de-de', url: 'https://acme.test/de/de/' },
  { lang: 'en-us', url: 'https://acme.test/us/en/' },
  { lang: 'en-gb', url: 'https://acme.test/gb/en/' },
  { lang: 'fr-fr', url: 'https://acme.test/fr/fr/' },
  { lang: 'x-default', url: 'https://acme.test/' },
]

describe('localVersion', () => {
  it('takes the version for the admin’s language and region, then for their language', () => {
    expect(localVersion(versions, ['en-gb', 'en'])).toBe('https://acme.test/gb/en/')
    expect(localVersion(versions, ['en-au', 'en'])).toBe('https://acme.test/us/en/')
    expect(localVersion(versions, ['fr'])).toBe('https://acme.test/fr/fr/')
  })

  it('takes none for a language the site does not offer', () => {
    expect(localVersion(versions, ['ja'])).toBeNull()
  })
})

describe('acceptLanguages', () => {
  it('reads an Accept-Language header into tags, most wanted first', () => {
    expect(acceptLanguages('en-GB,en;q=0.9,fr;q=0.8')).toEqual(['en-gb', 'en', 'fr'])
    expect(acceptLanguages('fr;q=0.5, de')).toEqual(['de', 'fr'])
    expect(acceptLanguages(null)).toEqual([])
  })
})
