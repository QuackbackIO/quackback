import { useIntl } from 'react-intl'
import { useRouteContext } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'
import { usePreviewHeadline, usePreviewHome } from './preview-draft-context'

/** Text in the visitor's language, else its base language, else English, else any. */
export function textForLocale(
  text: Record<string, string> | undefined,
  locale: string
): string | undefined {
  if (!text) return undefined
  const base = locale.split('-')[0]
  return text[locale] || text[base] || text.en || Object.values(text).find(Boolean)
}

/** The band's colour: plain on phones where the design asks, as a mesh crosses the words there. */
const BAND_FILL =
  '[background:var(--qb-band-bg-narrow,var(--qb-band-bg))] sm:[background:var(--qb-band-bg)]'

const ACCENT_CLASS = {
  colour: 'text-[var(--qb-band-accent)]',
  highlight:
    'px-[0.08em] [box-decoration-break:clone] [background:linear-gradient(transparent_58%,var(--qb-band-highlight)_58%,var(--qb-band-highlight)_92%,transparent_92%)]',
} as const

/** The title with its accent phrase set apart, when the title holds it. */
function accented(
  title: string,
  phrase: string | undefined,
  style: keyof typeof ACCENT_CLASS | undefined
): ReactNode {
  const at = phrase && style ? title.indexOf(phrase) : -1
  if (at < 0) return title
  return (
    <>
      {title.slice(0, at)}
      <span data-qb-accent={style} className={ACCENT_CLASS[style!]}>
        {phrase}
      </span>
      {title.slice(at + phrase!.length)}
    </>
  )
}

/**
 * The band at the top of the feedback page or Home, behind its headline. Its look
 * comes from the design's band tokens and data-qb-band. With no headline
 * there is no band, in the preview too, so a style never shows as an empty
 * block. Only the design engine draws it.
 */
export function PortalBand({
  page = 'feedback',
  children,
}: {
  page?: 'feedback' | 'home'
  /** What sits under the headline, such as Home's composer. */
  children?: ReactNode
}) {
  const intl = useIntl()
  const design = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.portalDesign,
  })
  const draftHeadline = usePreviewHeadline()
  const draftHome = usePreviewHome()
  if (design?.engine !== 'v2') return null
  const headline =
    page === 'home'
      ? (draftHome ?? design.home).headline
      : draftHeadline !== undefined
        ? draftHeadline
        : design.feedback.headline
  const title = textForLocale(headline?.title, intl.locale)
  const subtitle = textForLocale(headline?.subtitle, intl.locale)
  const phrase = textForLocale(headline?.accent?.text, intl.locale)
  if (!title && !subtitle && !children) return null
  return (
    <section
      data-qb-section="band"
      data-qb-part="band"
      className={cn(
        'portal-band py-10 [[data-qb-band=none]_&]:py-0',
        BAND_FILL,
        // Inset: the band's colour moves onto a rounded panel within the page.
        '[[data-qb-band-shape=inset]_&]:![background:transparent] [[data-qb-band-shape=inset]_&]:py-3'
      )}
    >
      <div
        className={cn(
          'mx-auto w-full max-w-[var(--qb-page-max,72rem)] px-4 pt-6 sm:px-6 [[data-qb-band=none]_&]:pb-0',
          '[[data-qb-band-align=centre]_&]:text-center',
          '[[data-qb-band-shape=inset]_&]:max-w-[calc(var(--qb-page-max,72rem)-2rem)] [[data-qb-band-shape=inset]_&]:rounded-[calc(var(--qb-radius-panel,0.75rem)*2.5)] [[data-qb-band-shape=inset]_&]:px-6 [[data-qb-band-shape=inset]_&]:py-10 sm:[[data-qb-band-shape=inset]_&]:px-12 sm:[[data-qb-band-shape=inset]_&]:py-14',
          '[[data-qb-band-shape=inset]_&]:[background:var(--qb-band-bg-narrow,var(--qb-band-bg))] sm:[[data-qb-band-shape=inset]_&]:[background:var(--qb-band-bg)]'
        )}
      >
        {/* Panel: the words sit on a block of the second colour, in its own text colours. */}
        <div className="[[data-qb-band-shape=panel]_&]:max-w-3xl [[data-qb-band-shape=panel]_&]:rounded-[var(--qb-radius-panel,0.75rem)] [[data-qb-band-shape=panel]_&]:bg-[var(--qb-band-panel-bg)] [[data-qb-band-shape=panel]_&]:p-6 sm:[[data-qb-band-shape=panel]_&]:p-10 [[data-qb-band-shape=panel]_&]:[--qb-band-ink:var(--qb-band-panel-ink)] [[data-qb-band-shape=panel]_&]:[--qb-band-muted:var(--qb-band-panel-muted)] [[data-qb-band-shape=panel]_&]:[--qb-band-accent:var(--qb-band-panel-accent)] [[data-qb-band-align=centre]_&]:mx-auto">
          {title && (
            <h1
              data-qb-part="headline"
              className="font-semibold text-[var(--qb-band-ink)] [font-size:var(--qb-headline-size)] [line-height:var(--qb-headline-leading)]"
            >
              {accented(title, phrase, headline?.accent?.style)}
            </h1>
          )}
          {subtitle && (
            <p className="mt-2 max-w-2xl text-base text-[var(--qb-band-muted)] [[data-qb-band-align=centre]_&]:mx-auto">
              {subtitle}
            </p>
          )}
          {children && (
            <div className="mt-7 max-w-[40rem] [[data-qb-band-align=centre]_&]:mx-auto [[data-qb-band-align=centre]_&]:text-left">
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
