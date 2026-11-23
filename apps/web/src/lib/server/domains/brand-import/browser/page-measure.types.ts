/**
 * What the browser reader's measurement returns (page-measure.ts), kept apart
 * so the measurement itself stays one self-contained function.
 */
export interface PageButton {
  bg: string
  fg: string
  radius: string
  h: number
}

/** A button as the page draws it, with where it sits; the reader picks the brand's from these. */
export interface PageCandidate extends PageButton {
  w: number
  top: number
  /** Its words, cut short. */
  text: string
  /** Inside the page's header or top navigation. */
  header: boolean
  /** Inside a cookie or consent banner, or a fixed or modal layer that talks about cookies. */
  overlay: boolean
}

/**
 * The parts of a measure the dark read keeps. `loaded` when the page was also
 * loaded afresh under a dark system, so the read stands for a visitor who
 * arrives with one: a site may take its scheme only as it loads.
 */
export type PageDarkMeasure = Pick<PageMeasure, 'bg' | 'text'> &
  Partial<
    Pick<PageMeasure, 'textColor' | 'candidates' | 'buttons' | 'surfaces' | 'texts' | 'borders'>
  > & { loaded?: boolean }

/** A filled box the page's words sit on, weighed by the words it carries. */
export interface PageSurface {
  bg: string
  chars: number
  rounded: boolean
  bordered: boolean
  shadowed: boolean
  /** As wide as the page: a band, not a card. */
  wide: boolean
}

export interface PageLogo {
  /** `svg`, or the image's tag name as the page gives it (`IMG`). */
  tag: string
  /** An image's address, absolute. */
  src: string | null
  /** The drawn size, in CSS px. */
  w: number
  h: number
  /** An inline SVG's markup, with any symbols it uses from elsewhere in the page. Untrusted. */
  svg?: string
  /** An inline SVG's text colour, which `currentColor` in it draws. */
  color?: string
  /**
   * The inks the logo is drawn in, each with the share of its pixels: added
   * by the reader after the read, which draws it and counts
   * (page-logo-ink.ts; newer readers only).
   */
  inks?: { color: string; share: number; box?: number[]; plate?: boolean }[]
  /** What the logo is labelled: its alt text, its title or its link's label (newer readers only). */
  label?: string
}

/** A `@font-face` source: an absolute address and its `format()` hint. */
export interface PageFontSource {
  url: string
  format?: string
}

/** One `@font-face` rule, as the page declares it. */
export interface PageFontFace {
  family: string
  /** The `font-weight` descriptor: `400`, `bold`, or a variable font's `100 900`. */
  weight: string
  style: string
  src: PageFontSource[]
  /** The `unicode-range` descriptor, when the font is split by script. */
  range?: string
}

/**
 * The files of the family the page's text is set in, as the browser has
 * them, base64: the regular first, then the bold. A font service's files
 * are named (`service`) and never included.
 */
export interface PageSiteFont {
  family: string
  service?: boolean
  /** A file was left out for its size. */
  tooLarge?: boolean
  files: { url: string; weight: number; weightTo?: number; data: string }[]
}

export interface PageMeasure {
  title: string
  /**
   * The name the page declares for the site: `og:site_name`, else its JSON-LD
   * organisation's. Added by the reader after the read (page-extras.ts;
   * newer readers only).
   */
  siteName?: string | null
  /** Every name the page declares, most trusted first (page-extras.ts; newer readers only). */
  names?: string[]
  /** The site's own word as the page's text writes it (page-extras.ts; newer readers only). */
  nameWritten?: string | null
  themeColor: string | null
  /**
   * The body's background, or the root's when the body's is transparent, or
   * (newer readers) the page-long wrapper's when neither paints.
   */
  bg: string
  text: string
  bodyFont: string
  /**
   * The largest visible h1 or h2. `minPx` is the smallest size the page
   * draws that face at, added by the reader after the read (page-extras.ts;
   * newer readers only).
   */
  h1: { font: string; minPx?: number } | null
  /** Filled buttons in page order, consent controls and page-coloured ones left out. */
  buttons: PageButton[]
  /** Every visible worded, filled button in page order (newer readers only). */
  candidates?: PageCandidate[]
  /** The boxes words sit on, the text colours and the border colours, most used first (newer readers only). */
  surfaces?: PageSurface[]
  /**
   * The words on the page's cards, by how each card stands off the page: an
   * edge, a shadow, or a fill alone. Tallied box by box, where `surfaces`
   * gathers every box of one colour. Added by the reader after the read
   * (page-extras.ts; newer readers only).
   */
  cards?: {
    border: number
    shadow: number
    flat: number
    /** The flat cards' fills, most words first. */
    flats?: { bg: string; chars: number }[]
  }
  texts?: { color: string; chars: number }[]
  borders?: { color: string; count: number }[]
  /**
   * The same page with the visitor's system set to dark: added by the reader
   * after the main read, when there was time (newer readers only).
   */
  dark?: PageDarkMeasure
  /**
   * The logo and icon images as the browser loaded them, base64: added by the
   * reader after the read (newer readers only).
   */
  assets?: { url: string; mime: string; data: string }[]
  /** The icons the page declares (newer readers only). */
  icons?: {
    url: string
    size: number | null
    type: string | null
    from: 'icon' | 'apple-touch-icon'
  }[]
  /** The page is a bot check's wall rather than the site (newer readers only). */
  wall?: boolean
  /**
   * The signs that say whether this is the site's own page: the main
   * document's HTTP status, the first heading, how the text starts and how
   * long it is, and the links. Added by the reader after the read
   * (page-signs.ts; newer readers only).
   */
  page?: {
    status: number | null
    heading: string
    lead: string
    words: number
    links: { href: string; text: string }[]
  }
  /** The font stack and text colour most of the page's words are set in (newer readers only). */
  textFont?: string
  textColor?: string
  /**
   * The header bar the logo sits on, when it has a colour of its own: its
   * fill and the colour its links are set in (newer readers only).
   */
  header?: { bg: string; text?: string; tall?: boolean } | null
  /**
   * The files the text is set in: added by the reader after the read, from
   * the page's `@font-face` rules (page-fonts.ts), when there was time (newer
   * readers only).
   */
  siteFont?: PageSiteFont
  /**
   * The files the largest heading is set in, when that is another family
   * than the text's: its semibold and bold, or its one variable file (newer
   * readers only).
   */
  headingFont?: PageSiteFont
  logo: PageLogo | null
  /**
   * The site's own dark-mode logo, when it has one: the logo the page shows
   * a visitor whose system is dark (`scheme`), a picture's dark-scheme source
   * (`picture`), or a twin of the logo the page marks for dark mode (`pair`).
   * Added by the reader after the read (newer readers only).
   */
  darkLogo?: PageLogo & { from: 'scheme' | 'picture' | 'pair' }
}
