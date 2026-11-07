/**
 * What a brand's own website says about its brand, read without running it:
 * the homepage's HTML and a few of its stylesheets, parsed (site-facts.ts),
 * and the few images worth fetching (site-read.ts). The brand match uses
 * these beside the screenshot: the facts settle names (the brand's, its
 * fonts', its logo and favicon files), the pixels settle the look.
 */

/** Where a font family was named. */
export interface FontFact {
  /** The first real family in the stack, as the site names it, hash suffixes and quotes gone. */
  family: string
  /** Every family in the stack, in order, cleaned the same way (fallbacks included). */
  stack: string[]
  /** The kind the stack falls back to (its generic family, or a known fallback's kind). */
  generic: 'serif' | 'sans' | 'mono' | null
  /** Where it came from: a selector (`h1`, `body`, `.title`) or a custom property (`--font-display`). */
  from: string
}

export type FaviconSource = 'icon' | 'apple-touch-icon' | 'manifest'
export interface FaviconCandidate {
  url: string
  /** The largest declared square side, or null. */
  size: number | null
  type: string | null
  from: FaviconSource
}

export type LogoSource = 'header-svg' | 'header-img' | 'json-ld' | 'og-image'
export interface LogoCandidate {
  from: LogoSource
  /** An image's URL (header-img, json-ld, og-image), absolute. */
  url?: string
  /** Inline SVG markup as found (header-svg). Untrusted: sanitise before use. */
  svg?: string
  /** The image's alt text or the link's label, when given. */
  alt?: string | null
  /** Lower is better. */
  rank: number
}

export interface ColourCandidate {
  /** #rrggbb, lowercase. */
  hex: string
  /** Where it was named: a custom property (`--brand-primary`), `button background`, `theme-color`. */
  from: string
  /** How strongly the name says brand: 3 brand/primary, 2 accent or a button, 1 theme-color. */
  weight: number
}

export interface SiteFacts {
  /** The page's final URL, after redirects. */
  url: string
  name: string | null
  nameFrom: 'og:site_name' | 'title' | 'logo-alt' | null
  /** The html lang, lowercased (en, en-gb, de). */
  language: string | null
  description: string | null
  /** The theme-color meta, as #rrggbb. */
  themeColour: string | null
  favicons: FaviconCandidate[]
  /** The web app manifest's URL, absolute, for the reader to fetch its icons. */
  manifest: string | null
  logos: LogoCandidate[]
  /** og:image, absolute. */
  shareImage: string | null
  fonts: {
    heading: FontFact | null
    body: FontFact | null
    /** Family names the stylesheets declare with @font-face. */
    faces: string[]
    /** Families loaded from a hosted open-licence font service's stylesheet link. */
    hosted: string[]
  }
  colours: ColourCandidate[]
  /** Stylesheets read, absolute (for the record). */
  stylesheets: string[]
}

/** An image fetched from the site, verified by its bytes. */
export interface SiteAsset {
  url: string
  mime:
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp'
    | 'image/gif'
    | 'image/x-icon'
    | 'image/avif'
    | 'image/svg+xml'
  bytes: Uint8Array
  width: number
  height: number
  /** Which candidate it was. */
  from: FaviconSource | LogoSource | 'share'
}

/** A site read: its facts and the images worth having, or why there are none. */
export interface SiteRead {
  facts: SiteFacts | null
  favicon: SiteAsset | null
  /** The best logo candidate, sanitised when SVG; whether it is used is the brand match's call. */
  logo: SiteAsset | null
  shareImage: SiteAsset | null
  /** Why the facts are missing or thin: the page could not be fetched, or is a bot challenge. */
  failed: 'fetch_failed' | 'not_html' | 'challenge' | 'blocked_url' | null
}

/** One fetch the reader makes; live, recorded or replayed from a snapshot. */
export interface FetchedBody {
  status: number
  /** The final URL, after redirects. */
  url: string
  contentType: string
  body: Uint8Array
}
export type SiteFetchKind = 'page' | 'css' | 'image' | 'manifest'
export type SiteFetcher = (
  url: string,
  kind: SiteFetchKind,
  limits: { maxBytes: number; timeoutMs: number }
) => Promise<FetchedBody | null>
