import { Link } from '@tanstack/react-router'
import { DocumentTextIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { FormattedMessage } from 'react-intl'
import {
  HelpCenterLanguageLabel,
  contentLangProps,
} from '@/components/help-center/help-center-category-grid'

/** One article in a collection page's list, named in its language when that is not the page's. */
export function HelpCenterArticleRow({
  href,
  title,
  description,
  readingTimeMinutes,
  textLocale,
  pageLocale,
}: {
  href: string
  title: string
  description?: string | null
  readingTimeMinutes?: number
  /** The language the title and description are in. */
  textLocale: string
  pageLocale: string
}) {
  const textLang = contentLangProps(textLocale, pageLocale)
  return (
    <Link
      to={href as '/hc'}
      className="group flex items-start gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors"
    >
      <DocumentTextIcon className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span
            {...textLang}
            className="text-sm text-foreground group-hover:text-primary-ink transition-colors font-medium"
          >
            {title}
          </span>
          <HelpCenterLanguageLabel locale={textLocale} pageLocale={pageLocale} />
        </span>
        {description && (
          <span
            {...textLang}
            className="block text-xs text-muted-foreground/60 mt-0.5 line-clamp-1"
          >
            {description}
          </span>
        )}
      </div>
      {readingTimeMinutes != null && (
        <span className="text-xs text-muted-foreground/50 shrink-0 tabular-nums mt-0.5">
          <FormattedMessage
            id="portal.hc.collection.readingTime"
            defaultMessage="{minutes} min read"
            values={{ minutes: readingTimeMinutes }}
          />
        </span>
      )}
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary-ink transition-colors mt-0.5" />
    </Link>
  )
}
