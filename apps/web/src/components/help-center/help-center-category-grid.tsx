import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { getTopLevelCategories } from './help-center-utils'
import { CategoryIcon } from './category-icon'
import { useHelpCenterMainLanguage } from '@/lib/client/hooks/use-help-center-main-language'
import { hcCollectionPath } from '@/lib/shared/help-center-url'
import { isRtlLocale } from '@/lib/shared/i18n'

interface SerializedCategory {
  id: string
  urlId: number
  parentId?: string | null
  slug: string
  name: string
  icon: string | null
  description: string | null
  articleCount: number
  /** The language the name and description are in. */
  locale?: string
}

interface HelpCenterCategoryGridProps {
  categories: SerializedCategory[]
  /** Content locale (domains/languages §2); omitted = default locale links. */
  locale?: string
}

export function HelpCenterCategoryGrid({ categories, locale }: HelpCenterCategoryGridProps) {
  const mainLanguage = useHelpCenterMainLanguage()
  const pageLocale = locale ?? mainLanguage
  const topLevel = getTopLevelCategories(categories)

  if (topLevel.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <FormattedMessage
          id="portal.hc.categoryGrid.empty"
          defaultMessage="No categories yet. Check back soon."
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {topLevel.map((cat, index) => (
        <Link
          key={cat.id}
          to={
            hcCollectionPath({
              locale: pageLocale,
              urlId: cat.urlId,
              slug: cat.slug,
            }) as '/hc'
          }
          className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background animate-in fade-in fill-mode-backwards"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10">
            <CategoryIcon icon={cat.icon} className="size-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3
                {...contentLangProps(cat.locale, pageLocale)}
                className="text-base font-semibold text-foreground"
              >
                {cat.name}
              </h3>
              <HelpCenterLanguageLabel locale={cat.locale} pageLocale={pageLocale} />
            </div>
            {cat.description && (
              <p
                {...contentLangProps(cat.locale, pageLocale)}
                className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground"
              >
                {cat.description}
              </p>
            )}
            <span className="mt-3 block text-xs font-medium text-muted-foreground">
              <FormattedMessage
                id="portal.hc.articleCount"
                defaultMessage="{count, plural, one {# article} other {# articles}}"
                values={{ count: cat.articleCount }}
              />
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

// ============================================================================
// Text in another language than the page's
// ============================================================================
//
// An article or collection with no version in the page's language reads in
// the language it is written in (see help-center-locale.query). The page
// names that language, and marks the text with it so screen readers, spelling
// and right-to-left layout follow the text rather than the page. These live
// with the grid so the help center home, which shows the grid, loads no
// further file for them.

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
      className="mt-6 rounded-lg border border-border/70 bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground"
    >
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
    </p>
  )
}
