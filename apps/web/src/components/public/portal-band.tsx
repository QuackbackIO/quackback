import { useIntl } from 'react-intl'
import { useRouteContext } from '@tanstack/react-router'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'
import {
  usePreviewBandImage,
  usePreviewHeadline,
  usePreviewHome,
  usePreviewTitles,
} from './preview-draft-context'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** A page whose title a design can word. */
export type TitledPage = keyof NonNullable<PortalDesign['pages']['titles']>

/** Text in the visitor's language, else its base language, else English, else any. */
export function textForLocale(
  text: Record<string, string> | undefined,
  locale: string
): string | undefined {
  if (!text) return undefined
  const base = locale.split('-')[0]
  return text[locale] || text[base] || text.en || Object.values(text).find(Boolean)
}

/** A band image comes from the workspace's own storage. */
const STORED_FILE = /^\/api\/storage\/[\w./-]+$/

/**
 * The band's image behind its words: along the bottom (on wider screens),
 * veiled by the band's colour so the words keep their contrast, or tiled
 * under a lighter veil.
 */
/** Band art in the brand's colours: along the bottom, or tiled faintly behind the words. */
const ART_FILL = [
  '[[data-qb-band-art=edge]_&]:[background:var(--qb-band-art)_center_bottom/var(--qb-band-art-size)_no-repeat,var(--qb-band-bg)] [[data-qb-band-art=edge]_&]:pb-32',
  '[[data-qb-band-art=tile]_&]:[background:var(--qb-band-art)_0_0/var(--qb-band-art-size)_repeat,var(--qb-band-bg)]',
].join(' ')

const IMAGE_FILL = [
  'sm:[&[data-qb-band-image=edge]]:[background:var(--qb-band-image)_center_bottom/100%_auto_no-repeat,var(--qb-band-bg)] sm:[&[data-qb-band-image=edge]]:pb-44',
  '[&[data-qb-band-image=cover]]:[background:linear-gradient(var(--qb-band-scrim),var(--qb-band-scrim)),var(--qb-band-image)_var(--qb-image-focus,center)/cover_no-repeat,var(--qb-band-bg)]',
  '[&[data-qb-band-image=pattern]]:[background:linear-gradient(var(--qb-band-scrim-soft),var(--qb-band-scrim-soft)),var(--qb-band-image)_0_0/280px_auto_repeat,var(--qb-band-bg)]',
].join(' ')

/** The band's colour: plain on phones where the design asks, as a mesh crosses the words there. */
const BAND_FILL =
  '[background:var(--qb-band-bg-narrow,var(--qb-band-bg))] sm:[background:var(--qb-band-bg)]'

const ACCENT_CLASS = {
  colour: 'text-[var(--qb-band-accent)]',
  highlight:
    'px-[0.08em] [box-decoration-break:clone] [background:linear-gradient(transparent_58%,var(--qb-band-highlight)_58%,var(--qb-band-highlight)_92%,transparent_92%)]',
} as const

/** The title with its accent phrase set apart, when the title holds it. */
export function accented(
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
  words,
  children,
}: {
  page?: 'feedback' | 'home' | TitledPage
  /** The page's usual title and line, for a page the design does not word. */
  words?: { title: string; subtitle?: string }
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
  const draftImage = usePreviewBandImage()
  const draftTitles = usePreviewTitles()
  if (design?.engine !== 'v2') return null
  const headline =
    page === 'home'
      ? (draftHome ?? design.home).headline
      : page === 'feedback'
        ? draftHeadline !== undefined
          ? draftHeadline
          : design.feedback.headline
        : (draftTitles ?? design.titles)[page]
  const title = textForLocale(headline?.title, intl.locale) || words?.title
  const subtitle = textForLocale(headline?.subtitle, intl.locale) || words?.subtitle
  // The other pages' titles sit a step below Home's headline.
  const titled = page !== 'home' && page !== 'feedback'
  const phrase = textForLocale(headline?.accent?.text, intl.locale)
  if (!title && !subtitle && !children) return null
  const shown = draftImage !== undefined ? draftImage : design.bandImage
  const image = shown && STORED_FILE.test(shown.url) ? shown : null
  const side = image?.place === 'side'
  return (
    <section
      data-qb-section="band"
      data-qb-part="band"
      data-qb-band-image={image && !side ? image.place : undefined}
      style={
        image && !side ? ({ '--qb-band-image': `url("${image.url}")` } as CSSProperties) : undefined
      }
      className={cn(
        'portal-band py-10 [[data-qb-band=none]_&]:py-0',
        BAND_FILL,
        ART_FILL,
        IMAGE_FILL,
        // Inset: the band's colour moves onto a rounded panel within the page.
        '[[data-qb-band-shape=inset]_&]:![background:transparent] [[data-qb-band-shape=inset]_&]:py-3'
      )}
    >
      <div
        className={cn(
          'mx-auto w-full max-w-[var(--qb-page-max,72rem)] px-4 pt-6 sm:px-6 [[data-qb-band=none]_&]:pb-0',
          '[[data-qb-band-align=centre]_&]:text-center',
          '[[data-qb-band-shape=inset]_&]:max-w-[calc(var(--qb-page-max,72rem)-2rem)] [[data-qb-band-shape=inset]_&]:rounded-[calc(var(--qb-radius-panel,0.75rem)*2.5)] [[data-qb-band-shape=inset]_&]:px-6 [[data-qb-band-shape=inset]_&]:py-10 sm:[[data-qb-band-shape=inset]_&]:px-12 sm:[[data-qb-band-shape=inset]_&]:py-14',
          '[[data-qb-band-shape=inset]_&]:[background:var(--qb-band-bg-narrow,var(--qb-band-bg))] sm:[[data-qb-band-shape=inset]_&]:[background:var(--qb-band-bg)]',
          // A side image sits beside the words, and under them on phones.
          side &&
            'md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,var(--qb-image-column,0.85fr))] md:items-center md:gap-10'
        )}
      >
        {/* Panel: the words sit on a block of the second colour, in its own text colours. */}
        <div className="[[data-qb-band-shape=panel]_&]:max-w-3xl [[data-qb-band-shape=panel]_&]:rounded-[var(--qb-radius-panel,0.75rem)] [[data-qb-band-shape=panel]_&]:bg-[var(--qb-band-panel-bg)] [[data-qb-band-shape=panel]_&]:p-6 sm:[[data-qb-band-shape=panel]_&]:p-10 [[data-qb-band-shape=panel]_&]:[--qb-band-ink:var(--qb-band-panel-ink)] [[data-qb-band-shape=panel]_&]:[--qb-band-muted:var(--qb-band-panel-muted)] [[data-qb-band-shape=panel]_&]:[--qb-band-accent:var(--qb-band-panel-accent)] [[data-qb-band-align=centre]_&]:mx-auto">
          {title && (
            <h1
              data-qb-part="headline"
              className={cn(
                'font-semibold text-[var(--qb-band-ink)] [[data-qb-headline=accent]_&]:text-[var(--qb-band-accent)] [line-height:var(--qb-headline-leading)]',
                titled
                  ? '[font-size:var(--qb-page-title-size)]'
                  : '[font-size:var(--qb-headline-size)]'
              )}
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
        {side && image && (
          <img
            src={image.url}
            alt=""
            data-qb-part="band-image"
            className="mt-6 max-h-48 w-full rounded-[var(--qb-radius-panel,0.75rem)] object-cover [object-position:var(--qb-image-focus,center)] md:mt-0 md:h-auto md:max-h-[26rem] md:[aspect-ratio:var(--qb-image-aspect,4/3)]"
          />
        )}
      </div>
    </section>
  )
}
