import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { thisDesignerFrame } from '@/lib/client/designer-frame'
import { composerWidthClass } from '@/lib/shared/design/composer-width'
import { focusPoint, photoSpan } from '@/lib/shared/design/photo-span'
import { cn } from '@/lib/shared/utils'
import { usePortalDesign } from './preview-draft-context'
import { ACCENT_CLASS } from '@/lib/shared/design/accent-class'
import type { ColourRole } from '@/lib/shared/design/rich-words'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** A page whose title a design can word. */
export type TitledPage = keyof NonNullable<PortalDesign['pages']['titles']>

/**
 * Text in the visitor's language, else its base language, else English, else
 * any; without `anyLanguage`, nothing past English, so a caller can fall back
 * to words of its own in the visitor's language.
 */
export function textForLocale(
  text: Record<string, string> | undefined,
  locale: string,
  { anyLanguage = true }: { anyLanguage?: boolean } = {}
): string | undefined {
  if (!text) return undefined
  const base = locale.split('-')[0]
  const near = text[locale] || text[base] || text.en
  return near || (anyLanguage ? Object.values(text).find(Boolean) : undefined)
}

/**
 * A headline's length in letters, which sizes it: the hero drops a long one's
 * size rather than let it run to many lines. A short one counts as a dozen,
 * so it is never sized up past the brand's own size by its length alone.
 */
function headlineChars(title: string): number {
  return Math.max(12, [...title.trim()].length)
}

/** A band image comes from the workspace's own storage. */
const STORED_FILE = /^\/api\/storage\/[\w./-]+$/
/** Its srcset: stored files by width, and nothing else. */
const STORED_SRCSET = /^\/api\/storage\/[\w./-]+ \d+w(?:,\/api\/storage\/[\w./-]+ \d+w)*$/
/** How wide a side image is drawn: about half the band beside the words, the full width under them. */
const SIDE_SIZES = '(min-width:768px) 50vw,100vw'

/**
 * The band's image behind its words: along the bottom (on wider screens),
 * veiled by the band's colour so the words keep their contrast, or tiled
 * under a lighter veil.
 */
/**
 * Band art in the brand's colours: along the bottom, or tiled faintly behind
 * the words. Tiles sit on a layer of their own under the words, over the
 * band's own fill, and fade out towards the band's foot rather than stop
 * mid-motif at its edge. A set-in panel's band is bare around the panel.
 * Written out in full: the stylesheet is built from class names as they
 * appear here.
 */
const ART_FILL = [
  '[[data-qb-band-art=edge]_&]:[background:var(--qb-band-art)_center_bottom/var(--qb-band-art-size)_no-repeat,var(--qb-band-bg)] [[data-qb-band-art=edge]_&]:pb-32',
  '[[data-qb-band-art=tile]_&]:relative [[data-qb-band-art=tile]_&]:isolate',
  '[[data-qb-band-art=tile]_&]:before:pointer-events-none [[data-qb-band-art=tile]_&]:before:absolute [[data-qb-band-art=tile]_&]:before:inset-0 [[data-qb-band-art=tile]_&]:before:-z-10',
  '[[data-qb-band-art=tile]_&]:before:[background:var(--qb-band-art)_0_0/var(--qb-band-art-size)_repeat]',
  '[[data-qb-band-art=tile]_&]:before:[mask-image:linear-gradient(to_bottom,black_35%,transparent_calc(100%-0.5rem))]',
  '[[data-qb-band-shape=inset]_&]:before:hidden [[data-qb-band-shape=split]_&]:before:hidden',
].join(' ')

const IMAGE_FILL = [
  // Along the bottom: room kept at the foot for the image (EdgeImage), on a band of any colour.
  'sm:[&[data-qb-band-image=edge]]:relative sm:[&[data-qb-band-image=edge]]:isolate sm:[&[data-qb-band-image=edge]]:!pb-44',
  '[&[data-qb-band-image=cover]]:[background:linear-gradient(var(--qb-band-scrim),var(--qb-band-scrim)),var(--qb-band-image)_var(--qb-image-focus,center)/cover_no-repeat,var(--qb-band-bg)]',
  '[&[data-qb-band-image=pattern]]:[background:linear-gradient(var(--qb-band-scrim-soft),var(--qb-band-scrim-soft)),var(--qb-band-image)_0_0/280px_auto_repeat,var(--qb-band-bg)]',
  // Left off on phones where the design asks: the band's own colour there.
  'max-sm:[[data-qb-image-phone=hide]_&]:[&[data-qb-band-image]]:[background:var(--qb-band-bg-narrow,var(--qb-band-bg))]',
  // Words on a veiled photo read on its measured worst colour, not on the band's own colour.
  '[&[data-qb-photo-shade]]:[--qb-band-ink:var(--qb-photo-ink)] [&[data-qb-photo-shade]]:[--qb-band-muted:var(--qb-photo-muted)] [&[data-qb-photo-shade]]:[--qb-band-accent:var(--qb-photo-accent)]',
  // Under a header on the photo: one picture behind both, the band showing all but its top (usePhotoSpan).
  '[[data-qb-header-span=photo]_&]:[&[data-qb-band-image=cover]]:[background:linear-gradient(var(--qb-band-scrim),var(--qb-band-scrim)),var(--qb-band-image)_var(--portal-band-image-below,var(--qb-image-focus,center))/var(--portal-band-image-size,cover)_no-repeat,var(--qb-band-bg)]',
].join(' ')

/**
 * A split panel: a rounded panel within the page, its words on one half and
 * the side image flush in the other, as one block of the band's colour.
 */
const SPLIT = {
  band: '[[data-qb-band-shape=split]_&]:![background:transparent] [[data-qb-band-shape=split]_&]:py-3',
  panel: [
    '[[data-qb-band-shape=split]_&]:max-w-[calc(var(--qb-page-max,72rem)-3rem)] sm:[[data-qb-band-shape=split]_&]:w-[calc(100%-3rem)] [[data-qb-band-shape=split]_&]:overflow-hidden [[data-qb-band-shape=split]_&]:rounded-[calc(var(--qb-radius-panel,0.75rem)*2.5)] [[data-qb-band-shape=split]_&]:p-0',
    '[[data-qb-band-shape=split]_&]:[background:var(--qb-band-bg-narrow,var(--qb-band-bg))] sm:[[data-qb-band-shape=split]_&]:[background:var(--qb-band-bg)]',
    'md:[[data-qb-band-shape=split]_&]:grid-cols-2 md:[[data-qb-band-shape=split]_&]:items-stretch md:[[data-qb-band-shape=split]_&]:gap-0',
  ].join(' '),
  words:
    '[[data-qb-band-shape=split]_&]:p-6 sm:[[data-qb-band-shape=split]_&]:p-12 md:[[data-qb-band-shape=split]_&]:self-center',
  image:
    '[[data-qb-band-shape=split]_&]:mt-0 [[data-qb-band-shape=split]_&]:rounded-none md:[[data-qb-band-shape=split]_&]:h-full md:[[data-qb-band-shape=split]_&]:max-h-none md:[[data-qb-band-shape=split]_&]:[aspect-ratio:auto]',
}

/**
 * The band's colour: its own composition on phones where the design has one,
 * as a mesh's glows move to the corners there. How it ends (band-foot.ts):
 * a fade into the page painted over its foot (--qb-band-foot), or the page's
 * colour over its bottom padding alone (--qb-band-foot-pad), drawn here as the
 * padding is the band's own; over a page of more than one colour, the band
 * fading out itself over that padding (--qb-band-fade-out). Under a header that
 * shares it, one background runs behind both: sized over the header and the
 * band, the band showing its foot.
 */
const BAND_FILL = [
  '[background:var(--qb-band-foot,none),linear-gradient(to_bottom,transparent_calc(100%-var(--qb-band-pad)),var(--qb-band-foot-pad,transparent)),var(--qb-band-bg-narrow,var(--qb-band-bg))] sm:[background:var(--qb-band-foot,none),linear-gradient(to_bottom,transparent_calc(100%-var(--qb-band-pad)),var(--qb-band-foot-pad,transparent)),var(--qb-band-bg)]',
  '[[data-qb-band-over=fill]_&]:[mask-image:linear-gradient(to_bottom,black_calc(100%-var(--qb-band-pad)),var(--qb-band-fade-out,black))]',
  '[[data-qb-header-span=on]_&]:![background-size:100%_calc(100%+var(--portal-header-height,0px))] [[data-qb-header-span=on]_&]:![background-position:bottom]',
].join(' ')

/**
 * The band's height, published as --portal-band-height, so a header sharing
 * its background sizes that background over both.
 */
function useBandHeight() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const band = ref.current
    if (!band) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--portal-band-height', `${band.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(band)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--portal-band-height')
    }
  })
  return ref
}

/**
 * A photo behind the words, measured for a header that sits on it: the
 * picture's size over the header and the band together, and where each shows
 * it, published on the page (--portal-band-image and the rest) for the header
 * to draw its top. Kept current as either resizes.
 */
function usePhotoSpan(ref: RefObject<HTMLElement | null>, url: string | null) {
  useEffect(() => {
    const band = ref.current
    if (!band || !url) return
    const root = document.documentElement
    const picture = new Image()
    let natural: { width: number; height: number } | null = null
    const publish = () => {
      if (!natural) return
      const header = document.querySelector<HTMLElement>('.portal-header')
      const span = photoSpan({
        natural,
        width: band.offsetWidth,
        band: band.offsetHeight,
        header: header?.offsetHeight ?? 0,
        focus: focusPoint(getComputedStyle(band).getPropertyValue('--qb-image-focus')),
      })
      root.style.setProperty('--portal-band-image', `url("${url}")`)
      root.style.setProperty('--portal-band-image-size', span.size)
      root.style.setProperty('--portal-band-image-at', span.header)
      root.style.setProperty('--portal-band-image-below', span.band)
    }
    picture.onload = () => {
      natural = { width: picture.naturalWidth, height: picture.naturalHeight }
      publish()
    }
    picture.src = url
    const observer = new ResizeObserver(publish)
    observer.observe(band)
    const header = document.querySelector<HTMLElement>('.portal-header')
    if (header) observer.observe(header)
    return () => {
      observer.disconnect()
      picture.onload = null
      for (const name of ['', '-size', '-at', '-below'])
        root.style.removeProperty(`--portal-band-image${name}`)
    }
  }, [ref, url])
}

/**
 * The title with its accent phrase set apart, when the title holds it, in
 * the colour role it names (the design's CSS reads it where it sits).
 */
export function accented(
  title: string,
  phrase: string | undefined,
  style: keyof typeof ACCENT_CLASS | undefined,
  colour?: ColourRole
): ReactNode {
  const at = phrase && style ? title.indexOf(phrase) : -1
  if (at < 0) return title
  return (
    <>
      {title.slice(0, at)}
      <span
        data-qb-accent={style}
        data-qb-accent-colour={colour && colour !== 'accent' ? colour : undefined}
        className={ACCENT_CLASS[style!]}
      >
        {phrase}
      </span>
      {title.slice(at + phrase!.length)}
    </>
  )
}

/**
 * Whether this is the builder's canvas frame. Read after mount, so the
 * server's page and the first client render agree and visitors never get it.
 */
function useInBuilder(): boolean {
  const [inBuilder, setInBuilder] = useState(false)
  useEffect(() => setInBuilder(thisDesignerFrame() !== null), [])
  return inBuilder
}

/**
 * What the builder shows where a page draws no hero, so there is something to
 * pick: a quiet dashed area, in neutral colours and the theme's fonts. Never
 * drawn for visitors or on the live portal.
 */
function PlaceholderHero() {
  return (
    <section
      data-qb-section="hero"
      data-qb-placeholder=""
      className="mx-auto my-4 flex min-h-28 w-full max-w-[var(--qb-page-max,72rem)] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-muted-foreground/40 px-4 text-center text-muted-foreground sm:px-6"
    >
      <p className="text-sm font-medium">Add a headline</p>
      <p className="text-xs">Visitors see nothing here until you do</p>
    </section>
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
  action,
  children,
}: {
  page?: 'feedback' | 'home' | TitledPage
  /** The page's usual title and line, for a page the design does not word. */
  words?: { title: string; subtitle?: string }
  /** What the children are when not Home's composer: the help search, or a call to action. */
  action?: 'search' | 'button'
  /** What sits under the headline, such as Home's composer. */
  children?: ReactNode
}) {
  const intl = useIntl()
  const design = usePortalDesign()
  const inBuilder = useInBuilder()
  const bandRef = useBandHeight()
  const shownImage = design?.engine === 'v2' ? design.bandImage : null
  usePhotoSpan(
    bandRef,
    shownImage?.place === 'cover' &&
      STORED_FILE.test(shownImage.url) &&
      !(shownImage.homeOnly && page !== 'home')
      ? shownImage.url
      : null
  )
  if (design?.engine !== 'v2') return null
  const headline =
    page === 'home'
      ? design.home.headline
      : page === 'feedback'
        ? design.feedback.headline
        : design.titles[page]
  const title = textForLocale(headline?.title, intl.locale) || words?.title
  const subtitle = textForLocale(headline?.subtitle, intl.locale) || words?.subtitle
  // The other pages' titles sit a step below Home's headline.
  const titled = page !== 'home' && page !== 'feedback'
  const phrase = textForLocale(headline?.accent?.text, intl.locale)
  if (!title && !subtitle && !children) return inBuilder ? <PlaceholderHero /> : null
  const shown = design.bandImage
  // A title keeps its band short: an image behind the words stays, one beside
  // or under them is Home's and the feed's.
  const image =
    shown &&
    STORED_FILE.test(shown.url) &&
    !(titled && (shown.place === 'side' || shown.place === 'edge')) &&
    // A photo for Home's hero only: the other pages keep the band's colour.
    !(shown.homeOnly && page !== 'home')
      ? shown
      : null
  const side = image?.place === 'side'
  return (
    <section
      ref={bandRef}
      data-qb-section="hero"
      data-qb-part="band"
      data-qb-band-image={image && !side ? image.place : undefined}
      data-qb-photo-shade={image?.place === 'cover' && image.shaded ? '' : undefined}
      style={
        image && !side ? ({ '--qb-band-image': `url("${image.url}")` } as CSSProperties) : undefined
      }
      className={cn(
        // Its padding, less on a phone, where a wide screen's would leave the hero half empty, and
        // its bottom padding, where a coloured band's foot may fade without crossing the words.
        // Home takes the design's height; the list pages follow Home's look at a compact one.
        'portal-band',
        page === 'home'
          ? 'py-8 sm:py-10 [[data-qb-band-height=compact]_&]:py-5 sm:[[data-qb-band-height=compact]_&]:py-6 [[data-qb-band-height=tall]_&]:py-10 sm:[[data-qb-band-height=tall]_&]:py-20 [--qb-band-pad:2rem] sm:[--qb-band-pad:2.5rem] [[data-qb-band-height=compact]_&]:[--qb-band-pad:1.25rem] sm:[[data-qb-band-height=compact]_&]:[--qb-band-pad:1.5rem] [[data-qb-band-height=tall]_&]:[--qb-band-pad:2.5rem] sm:[[data-qb-band-height=tall]_&]:[--qb-band-pad:5rem]'
          : 'py-5 sm:py-6 [--qb-band-pad:1.25rem] sm:[--qb-band-pad:1.5rem]',
        // A bare hero keeps room under the header, and none at its foot.
        '[[data-qb-band=none]_&]:!pt-6 [[data-qb-band=none]_&]:!pb-0',
        BAND_FILL,
        ART_FILL,
        IMAGE_FILL,
        titled && 'py-6 sm:py-6 ![--qb-band-pad:1.5rem] [[data-qb-band-art=edge]_&]:pb-20',
        // A glow from the foot sits under Home's composer; under another page's words, low on its
        // band, it would wash them out, so there the band is its colour alone.
        page !== 'home' && '[[data-qb-band-glow=foot]_&]:[--qb-band-bg:var(--qb-band-plain)]',
        // Inset: the band's colour moves onto a rounded panel within the page.
        '[[data-qb-band-shape=inset]_&]:![background:transparent] [[data-qb-band-shape=inset]_&]:py-3',
        SPLIT.band
      )}
    >
      <div
        className={cn(
          'mx-auto w-full max-w-[var(--qb-page-max,72rem)] px-4 sm:px-6 pt-2 sm:pt-6 [[data-qb-band=none]_&]:pb-0',
          '[[data-qb-band-align=centre]_&]:text-center',
          '[[data-qb-band-shape=inset]_&]:max-w-[calc(var(--qb-page-max,72rem)-3rem)] sm:[[data-qb-band-shape=inset]_&]:w-[calc(100%-3rem)] [[data-qb-band-shape=inset]_&]:rounded-[calc(var(--qb-radius-panel,0.75rem)*2.5)] [[data-qb-band-shape=inset]_&]:px-6 [[data-qb-band-shape=inset]_&]:py-10 sm:[[data-qb-band-shape=inset]_&]:px-12 sm:[[data-qb-band-shape=inset]_&]:py-14',
          '[[data-qb-band-shape=inset]_&]:[background:var(--qb-band-bg-narrow,var(--qb-band-bg))] sm:[[data-qb-band-shape=inset]_&]:[background:var(--qb-band-bg)]',
          titled && 'sm:[[data-qb-band-shape=inset]_&]:py-10',
          // A side image sits beside the words, and under them on phones.
          side &&
            'md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,var(--qb-image-column,0.85fr))] md:items-center md:gap-10',
          SPLIT.panel
        )}
      >
        {/* Panel: the words sit on a block of the second colour, in its own text colours. */}
        <div
          className={cn(
            // The headline measures its size against the words' own width.
            '[container-type:inline-size]',
            SPLIT.words,
            '[[data-qb-band-shape=panel]_&]:max-w-3xl [[data-qb-band-shape=panel]_&]:rounded-[var(--qb-radius-panel,0.75rem)] [[data-qb-band-shape=panel]_&]:bg-[var(--qb-band-panel-bg)] [[data-qb-band-shape=panel]_&]:p-6 sm:[[data-qb-band-shape=panel]_&]:p-10 [[data-qb-band-shape=panel]_&]:[--qb-band-ink:var(--qb-band-panel-ink)] [[data-qb-band-shape=panel]_&]:[--qb-band-muted:var(--qb-band-panel-muted)] [[data-qb-band-shape=panel]_&]:[--qb-band-accent:var(--qb-band-panel-accent)] [[data-qb-band-align=centre]_&]:mx-auto'
          )}
        >
          {title && (
            <h1
              data-qb-part="headline"
              data-qb-words={`${page}.title`}
              className={cn(
                // The headline is large text: on a bright band it may take light text the band's other text cannot (components.ts bandWords).
                'font-semibold text-[var(--qb-band-headline,var(--qb-band-ink))] [[data-qb-headline=accent]_&]:text-[var(--qb-band-accent)] [text-wrap:balance]',
                // Lines never close up so far that a descender reaches the line under it.
                '[line-height:max(var(--qb-headline-leading,1.2),1.04)]',
                // Room above it and to its subtitle, both growing with it.
                'mt-[max(0rem,calc(0.4em-1.25rem))] mb-[max(0.5rem,calc(0.35em-0.5rem))]',
                titled
                  ? '[font-size:var(--qb-page-title-size)]'
                  : // The brand's size, kept between a floor and a ceiling, and dropping as
                    // a long headline would otherwise run past two or three lines.
                    '[font-size:max(var(--qb-headline-floor,1.875rem),min(var(--qb-headline-size),var(--qb-headline-cap,7.5rem),100cqi*var(--qb-headline-measure,4.2)/var(--qb-headline-chars)))]'
              )}
              style={{ '--qb-headline-chars': headlineChars(title) } as CSSProperties}
            >
              {accented(title, phrase, headline?.accent?.style, headline?.accent?.colour)}
            </h1>
          )}
          {subtitle && (
            <p
              data-qb-part="subtitle"
              data-qb-words={`${page}.subtitle`}
              className="mt-2 max-w-2xl text-[length:var(--qb-band-subtitle-size,var(--qb-subtitle-size,1rem))] leading-snug text-[var(--qb-band-subtitle,var(--qb-band-muted))] [font-weight:var(--qb-band-subtitle-weight)] [text-wrap:pretty] [[data-qb-band-align=centre]_&]:mx-auto"
            >
              {subtitle}
            </p>
          )}
          {children && action === 'button' && (
            <div
              data-qb-band-action="button"
              className="mt-6 flex flex-wrap items-center gap-3 sm:mt-7 [[data-qb-band-align=centre]_&]:justify-center"
            >
              {children}
            </div>
          )}
          {children && action === 'search' && (
            <div
              data-qb-band-action="search"
              className={cn(
                'mt-6 sm:mt-7 [[data-qb-band-align=centre]_&]:mx-auto [[data-qb-band-align=centre]_&]:text-left',
                // The search keeps the composer's usual measure.
                composerWidthClass(undefined, side)
              )}
            >
              {children}
            </div>
          )}
          {children && !action && (
            <div
              data-qb-band-composer=""
              className={cn(
                'mt-6 sm:mt-7 [[data-qb-band-align=centre]_&]:mx-auto [[data-qb-band-align=centre]_&]:text-left',
                // Home's own step, else beside an image or centred a measure, and otherwise the
                // words' full width, as the cards run.
                composerWidthClass(page === 'home' ? design.home.composerWidth : undefined, side)
              )}
            >
              {children}
            </div>
          )}
        </div>
        {side && image && (
          <img
            src={image.url}
            {...(image.srcSet && STORED_SRCSET.test(image.srcSet)
              ? { srcSet: image.srcSet, sizes: SIDE_SIZES }
              : {})}
            // The hero is the page's largest paint: fetched first.
            fetchPriority="high"
            alt={image.alt ?? ''}
            data-qb-part="band-image"
            className={cn(
              'mt-6 max-h-48 w-full rounded-[var(--qb-radius-panel,0.75rem)] object-cover [object-position:var(--qb-image-focus,center)] md:mt-0 md:h-auto md:max-h-[26rem] md:[aspect-ratio:var(--qb-image-aspect,4/3)]',
              'max-md:[[data-qb-image-phone=hide]_&]:hidden',
              SPLIT.image
            )}
          />
        )}
      </div>
      {image?.place === 'edge' && <EdgeImage />}
    </section>
  )
}

/**
 * An image along the bottom of the band, in the strip kept for it at the
 * foot, fading in at its top. It never runs up behind the words, where it
 * would cost them their contrast with the band. Left off on phones.
 */
function EdgeImage() {
  return (
    <div
      aria-hidden
      data-qb-part="band-foot-image"
      className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 hidden h-44 [background:var(--qb-band-image)_center_bottom/100%_auto_no-repeat] [mask-image:linear-gradient(transparent,black_3rem)] sm:block"
    />
  )
}
