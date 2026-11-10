/**
 * Guard: each language has one word for a post. Whatever a catalogue says for
 * posts, it never calls them ideas, suggestions or feature requests, for
 * visitors or admins. A word that only looks like one, in an idiom or with
 * another meaning, is allowed key by key with the reason.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LOCALES = join(import.meta.dirname, '..')

/** Words a language must not use for posts. Letter boundaries, not \b, so they hold beyond ASCII. */
const REJECTED: Record<string, RegExp> = {
  en: /(?<!\p{L})ideas?(?!\p{L})|suggest a feature|feature requests?/iu,
  de: /idee|vorschl[äa]g|feature-?wunsch/iu,
  es: /(?<!\p{L})ideas?(?!\p{L})|sugerencias?/iu,
  fr: /(?<!\p{L})idées?(?!\p{L})|suggestions?/iu,
  nl: /(?<!\p{L})idee(ën)?(?!\p{L})|suggestie/iu,
  pl: /pomysł|propozycj|sugesti/iu,
  'pt-br': /(?<!\p{L})ideias?(?!\p{L})|sugest(ão|ões)/iu,
  ru: /предложени|(?<!\p{L})иде(я|и|ю|й|е|ей|ям|ями|ях)(?!\p{L})/iu,
  uk: /пропозиці|(?<!\p{L})іде(я|ї|ю|й|єю|ям|ями|ях)(?!\p{L})/iu,
  ar: /فكرة|أفكار|الأفكار|الفكرة|اقتراح/u,
  th: /ไอเดีย/u,
  'zh-cn': /想法/u,
  'zh-tw': /想法/u,
}

/** Messages where a rejected word is not a post, with why. */
const ALLOWED: Record<string, Record<string, string>> = {
  'pt-br': { 'unsubscribe.onboarding.turnBackOn': '"Mudou de ideia?" is "changed your mind?"' },
}

const catalogues = readdirSync(LOCALES)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({
    locale: file.replace('.json', ''),
    messages: JSON.parse(readFileSync(join(LOCALES, file), 'utf8')) as Record<string, string>,
  }))

describe('one word for posts in each language', () => {
  it('knows every catalogue', () => {
    expect(catalogues.map(({ locale }) => locale).sort()).toEqual(Object.keys(REJECTED).sort())
  })

  it.each(catalogues)('$locale never calls a post anything else', ({ locale, messages }) => {
    const allowed = ALLOWED[locale] ?? {}
    const misnamed = Object.entries(messages)
      .filter(([key, message]) => !(key in allowed) && REJECTED[locale].test(message))
      .map(([key, message]) => `${key}: ${message}`)
    expect(misnamed).toEqual([])
  })

  it.each(catalogues)('$locale allows only messages that still need it', ({ locale, messages }) => {
    const stale = Object.keys(ALLOWED[locale] ?? {}).filter(
      (key) => !(key in messages) || !REJECTED[locale].test(messages[key])
    )
    expect(stale).toEqual([])
  })
})
