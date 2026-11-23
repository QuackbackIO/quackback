/**
 * The readers Import can use. Each reads one website into a `BrandRead`; the
 * static reader (HTML and CSS, nothing run) always works, and a browser
 * reader that measures the rendered page can be added beside it. When both
 * read a site, the browser's values win and the static read fills the gaps.
 */
import type { BrandRead } from '@/lib/shared/theme/brand-import'
import type { PageLink } from './site/page-kind'

/**
 * Why a reader read nothing: the site could not be fetched, or showed
 * something in its own page's place (site/page-kind.ts): a bot check, an
 * error or maintenance page, or a country picker.
 */
export type BrandReadFailure = 'unreachable' | 'challenge' | 'error' | 'picker'

export type BrandReaderResult =
  | { read: BrandRead }
  | {
      failed: BrandReadFailure
      /** A picker's links, and the page they were on, for the addresses to offer instead. */
      links?: PageLink[]
      pageUrl?: string
      /** The local versions a picker names with hreflang. */
      localVersions?: { lang: string; url: string }[]
    }

export interface BrandReader {
  name: 'static' | 'browser'
  /** Reads the homepage at `url` (already checked: a public website, robots allowing). */
  read(url: string): Promise<BrandReaderResult>
}

const defined = <T extends object>(value: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>

/**
 * `preferred`'s values, with `fallback`'s where it has none. Page, button,
 * card and font values merge field by field; a logo or palette is taken
 * whole, since its parts only make sense together.
 */
/**
 * Both reads' page colours, the preferred one's winning. The header bar is
 * the preferred read's alone when it read a page: a rendered page with no
 * header fill has a bar that shows the page (a transparent bar over the
 * body), which is not a gap for the stylesheet read to fill.
 */
function pageOf(preferred: BrandRead, fallback: BrandRead): BrandRead['page'] {
  if (!preferred.page) return fallback.page
  const page = { ...defined(fallback.page), ...defined(preferred.page) }
  delete page.header
  delete page.headerText
  if (preferred.page.header) page.header = preferred.page.header
  if (preferred.page.headerText) page.headerText = preferred.page.headerText
  return page
}

export function mergeBrandReads(preferred: BrandRead, fallback: BrandRead): BrandRead {
  const pick = <K extends keyof BrandRead>(key: K) => preferred[key] ?? fallback[key]
  const both = <K extends 'page' | 'button' | 'card' | 'fonts'>(key: K) =>
    preferred[key] || fallback[key]
      ? ({ ...defined(fallback[key]), ...defined(preferred[key]) } as BrandRead[K])
      : undefined
  return defined<BrandRead>({
    title: pick('title'),
    siteName: pick('siteName'),
    nameWritten: pick('nameWritten'),
    names:
      preferred.names || fallback.names
        ? [...new Set([...(preferred.names ?? []), ...(fallback.names ?? [])])]
        : undefined,
    page: pageOf(preferred, fallback),
    button: both('button'),
    card: both('card'),
    fonts: both('fonts'),
    siteFont: pick('siteFont'),
    siteHeadingFont: pick('siteHeadingFont'),
    logo: pick('logo'),
    // Only beside the logo it stands in for: never one reader's dark logo with the other's logo.
    darkLogo: preferred.logo ? preferred.darkLogo : undefined,
    icon: pick('icon'),
    themeColor: pick('themeColor'),
    logoColour: pick('logoColour'),
    dark: pick('dark'),
    palette: pick('palette'),
  })
}
