/**
 * How a help center page shows text that is not in the page's language: an
 * article or collection with no version in that language reads in the
 * language it is written in (see help-center-locale.query). The page names
 * that language, and marks the text with it so screen readers, spelling and
 * right-to-left layout follow the text rather than the page.
 */
import { FormattedMessage, useIntl } from 'react-intl'
import { LanguageIcon } from '@heroicons/react/24/outline'
import { isRtlLocale } from '@/lib/shared/i18n'

/**
 * `lang` and `dir` for text in `contentLocale` on a page in `pageLocale`, or
 * nothing when they match.
 */
export function contentLangProps(
  contentLocale: string | undefined,
  pageLocale: string
): { lang?: string; dir?: 'ltr' | 'rtl' } {
  if (!contentLocale || contentLocale === pageLocale) return {}
  const [language, region] = contentLocale.split('-')
  return {
    lang: region ? `${language}-${region.toUpperCase()}` : language,
    dir: isRtlLocale(contentLocale) ? 'rtl' : 'ltr',
  }
}

const LANGUAGE_NAMES: Record<string, { id: string; defaultMessage: string }> = {
  en: { id: 'portal.hc.language.en', defaultMessage: 'English' },
  de: { id: 'portal.hc.language.de', defaultMessage: 'German' },
  fr: { id: 'portal.hc.language.fr', defaultMessage: 'French' },
  es: { id: 'portal.hc.language.es', defaultMessage: 'Spanish' },
  ar: { id: 'portal.hc.language.ar', defaultMessage: 'Arabic' },
  ru: { id: 'portal.hc.language.ru', defaultMessage: 'Russian' },
  'pt-br': { id: 'portal.hc.language.pt-br', defaultMessage: 'Portuguese (Brazil)' },
  'zh-cn': { id: 'portal.hc.language.zh-cn', defaultMessage: 'Chinese (Simplified)' },
  'zh-tw': { id: 'portal.hc.language.zh-tw', defaultMessage: 'Chinese (Traditional)' },
  nl: { id: 'portal.hc.language.nl', defaultMessage: 'Dutch' },
  pl: { id: 'portal.hc.language.pl', defaultMessage: 'Polish' },
  th: { id: 'portal.hc.language.th', defaultMessage: 'Thai' },
  uk: { id: 'portal.hc.language.uk', defaultMessage: 'Ukrainian' },
}

/** A language's name in the page's language; its code for a language the product does not have. */
export function useLanguageName(): (locale: string) => string {
  const intl = useIntl()
  return (locale) => {
    const name = LANGUAGE_NAMES[locale]
    return name ? intl.formatMessage(name) : locale
  }
}

/** A small label naming the language of an item that is not in the page's language. */
export function HelpCenterLanguageLabel({
  locale,
  pageLocale,
}: {
  locale: string | undefined
  pageLocale: string
}) {
  const languageName = useLanguageName()
  if (!locale || locale === pageLocale) return null
  return (
    <span
      data-testid="hc-language-label"
      className="inline-flex shrink-0 items-center rounded-md border border-border/70 px-1.5 py-0.5 align-middle text-[11px] font-medium leading-none text-muted-foreground"
    >
      {languageName(locale)}
    </span>
  )
}

/**
 * The notice over an article or collection shown in its own language because
 * it has no version in the page's language.
 */
export function HelpCenterFallbackNotice({
  kind,
  locale,
  pageLocale,
}: {
  kind: 'article' | 'collection'
  locale: string | undefined
  pageLocale: string
}) {
  const languageName = useLanguageName()
  if (!locale || locale === pageLocale) return null
  const values = { language: languageName(locale) }
  return (
    <p
      role="note"
      data-testid="hc-fallback-notice"
      className="mt-6 flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground"
    >
      <LanguageIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        {kind === 'article' ? (
          <FormattedMessage
            id="portal.hc.fallback.article"
            defaultMessage="This article is not translated yet, so it shows in its original language: {language}."
            values={values}
          />
        ) : (
          <FormattedMessage
            id="portal.hc.fallback.collection"
            defaultMessage="This collection is not translated yet, so it shows in its original language: {language}."
            values={values}
          />
        )}
      </span>
    </p>
  )
}
