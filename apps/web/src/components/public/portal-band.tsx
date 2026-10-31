import { useIntl } from 'react-intl'
import { useRouteContext } from '@tanstack/react-router'
import { usePreviewHeadline } from './preview-draft-context'

/** Text in the visitor's language, else its base language, else English, else any. */
export function textForLocale(
  text: Record<string, string> | undefined,
  locale: string
): string | undefined {
  if (!text) return undefined
  const base = locale.split('-')[0]
  return text[locale] || text[base] || text.en || Object.values(text).find(Boolean)
}

/**
 * The band at the top of the feedback page or Home, behind its headline. Its look
 * comes from the design's band tokens and data-qb-band. With no headline
 * there is no band, in the preview too, so a style never shows as an empty
 * block. Only the design engine draws it.
 */
export function PortalBand({ page = 'feedback' }: { page?: 'feedback' | 'home' }) {
  const intl = useIntl()
  const design = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.portalDesign,
  })
  const draftHeadline = usePreviewHeadline()
  if (design?.engine !== 'v2') return null
  const headline =
    page === 'home'
      ? design.home.headline
      : draftHeadline !== undefined
        ? draftHeadline
        : design.feedback.headline
  const title = textForLocale(headline?.title, intl.locale)
  const subtitle = textForLocale(headline?.subtitle, intl.locale)
  if (!title && !subtitle) return null
  return (
    <section
      data-qb-section="band"
      className="portal-band [background:var(--qb-band-bg)] py-10 [[data-qb-band=none]_&]:py-0"
    >
      {(title || subtitle) && (
        // Under a centred header the headline centres too.
        <div className="mx-auto w-full max-w-[var(--qb-page-max,72rem)] px-4 pt-6 sm:px-6 [[data-qb-band=none]_&]:pb-0 [[data-qb-header=centered]_&]:text-center">
          {title && (
            <h1 className="text-2xl font-semibold text-[var(--qb-band-ink)] sm:text-3xl">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="mt-2 max-w-2xl text-base text-[var(--qb-band-muted)] [[data-qb-header=centered]_&]:mx-auto">
              {subtitle}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
