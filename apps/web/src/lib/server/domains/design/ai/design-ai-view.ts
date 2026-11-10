/**
 * Where the person is when they ask: the page on the designer's canvas and
 * the language it shows. A request is read for that page, and words are
 * written in that language and said to be.
 */
import type { AppliedDesignChange } from '@/lib/shared/design/apply-changes'
import { PAGE_NAMES, type DesignerPage } from '@/lib/shared/design/outline'

/** A language code as a reply names it, such as German for de. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/**
 * Where the person is: the page on the canvas and the language it shows, so
 * "this page" reads as that page and words go in that language.
 */
export function viewNote(page: DesignerPage | undefined, locale: string | undefined): string {
  const language = locale ? languageName(locale) : null
  return [
    page && `The person is looking at the ${PAGE_NAMES[page]} page.`,
    language &&
      `The page is shown in ${language}: write any words they ask for in ${language}. Plain text in a field by language sets ${language} and leaves the other languages alone.`,
    REPLY_LANGUAGE,
  ]
    .filter(Boolean)
    .join(' ')
}

/** The language a reply is in: the person's own, with parts named in it. */
const REPLY_LANGUAGE =
  'Write reply and says in the language of the request, naming each part in that language rather than by the English names listed here.'

/** Short English words nearly every English request of a few words has. */
const ENGLISH_WORDS =
  /\b(the|a|an|it|this|that|these|to|of|in|on|and|or|with|make|give|set|use|just|only|all|every|my|our|more|less|bigger|smaller|darker|lighter|please)\b/i

/**
 * Whether a request reads as English, so a reply the server writes in English
 * suits it: no letters outside Latin, no accented letters, and an English
 * word in any request of three words or more.
 */
export function writtenInEnglish(text: string): boolean {
  const words = text.trim()
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(words)) return false
  if (/[\u00C0-\u024F]/.test(words)) return false
  return words.split(/\s+/).length < 3 || ENGLISH_WORDS.test(words)
}

/** Words written in a language other than English, said so the person knows which. */
export function languageNote(applied: AppliedDesignChange[], locale: string | undefined): string {
  if (!locale || locale === 'en') return ''
  const wrote = applied.some((change) => {
    const after = change.after as Record<string, unknown> | null
    const before = change.before as Record<string, unknown> | null
    return (
      !!after &&
      typeof after === 'object' &&
      typeof after[locale] === 'string' &&
      after[locale] !== before?.[locale]
    )
  })
  return wrote ? ` The words are in ${languageName(locale)}, the language shown.` : ''
}
