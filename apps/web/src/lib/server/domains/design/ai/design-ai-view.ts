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
  ]
    .filter(Boolean)
    .join(' ')
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
