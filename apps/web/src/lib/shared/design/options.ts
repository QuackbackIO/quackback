import { COMPOSER_WIDTHS } from './composer-width'

/**
 * Every choice a portal design offers, in one place. The design schema, the
 * reference-brand coverage test and Appearance's tiles all read these lists,
 * so an option added here is offered, validated and tested together.
 */
export const DESIGN_OPTIONS = {
  /** `auto` follows the visitor's device. */
  mode: ['light', 'dark', 'auto'],
  corners: ['sharp', 'subtle', 'rounded', 'pill'],
  /** Buttons' own shape; `match` follows the corners. */
  buttons: ['match', 'square', 'rounded', 'pill'],
  /** Status markers: coloured dots, dots in the ink, tinted tags, or the logo's colours. */
  status: ['colour', 'ink', 'pill', 'brand'],
  /** 300 and 400 for light display type, as some brands set their large headlines. */
  headingWeight: [300, 400, 500, 600, 700, 800],
  fontKind: ['bundled', 'uploaded'],
  /** The icon and title, a full logo image, or (stored designs only) the icon or the title alone. */
  logoDisplay: ['mark_and_name', 'mark', 'wordmark', 'name'],
  /** A logo image's ink, so the header redraws it where it would swallow it. */
  logoTone: ['dark', 'light'],
  /** Text in the ink, or in the brand colour. */
  inkOrAccent: ['ink', 'accent'],
  /** How large page headlines are. */
  typeScale: ['standard', 'large', 'display'],
  /** How closely headings are set. */
  tracking: ['normal', 'tight'],
  /** Headlines, or labels (the menu and buttons), in sentence or upper case. */
  textCase: ['sentence', 'upper'],
  /** How a headline marks out a phrase: in the accent colour, or highlighted. */
  headlineAccent: ['colour', 'highlight', 'muted'],
  header: ['stacked', 'inline', 'centered'],
  /** Where an inline header's menu sits: beside the logo, or centred between it and the buttons. */
  menuAlign: ['start', 'centre'],
  /** What buttons, post cards and links do under the pointer: nothing, rise, or nudge an arrow. */
  hover: ['none', 'arrow'],
  /** `plain` marks the current page by darker, heavier text alone. */
  nav: ['tabs', 'underline', 'pills', 'plain'],
  /** The menu's other pages: in a softer grey, or in the text colour, as most brands' menus are. */
  navText: ['muted', 'ink'],
  /** `support` fills with the second brand colour; `blend` runs the two together. */
  band: ['none', 'tint', 'fade', 'brand', 'support', 'blend'],
  /** How a blend band runs: in a line, as a soft mesh beside the words, or as a diagonal ribbon beside them. */
  blend: ['linear', 'mesh', 'ribbon'],
  /** A colour of the brand's: the brand colour, the second, or one of up to two more. */
  /** The same list as content-html's COLOUR_ROLES (kept apart so neither loads the other). */
  colourRole: ['accent', 'support', 'extra1', 'extra2'],
  /** Where the band's words sit. */
  bandAlign: ['left', 'centre'],
  /**
   * The band across the page, as a rounded panel within it, with its words on
   * a panel, or as a panel split between the words and a side image.
   */
  bandShape: ['full', 'inset', 'panel', 'split'],
  /** How much room the band gives its words, top and bottom. */
  bandHeight: ['compact', 'roomy', 'tall'],
  /** Where a fade band starts from: its top, or its foot. */
  fadeFrom: ['top', 'bottom'],
  /** A soft glow of light on a brand or second-colour band: none, rising from its foot, along its top, or in a corner. */
  bandGlow: ['none', 'bottom', 'top', 'corner'],
  /** Where the band's image sits: beside the words, along its bottom, behind them, or tiled. */
  imagePlace: ['side', 'edge', 'cover', 'pattern'],
  /** Quiet art drawn in the brand's colours, for a band without an image. */
  bandArt: ['none', 'dots', 'grid', 'lines', 'waves', 'hills', 'petals', 'confetti'],
  /** The band's image on phones: shown, or left off where a narrow crop would not read. */
  imagePhone: ['show', 'hide'],
  /** Where an image is cropped toward when it does not fit. */
  imageFocus: ['left', 'centre', 'right'],
  /** The other pages' titles: plain on the page, or on the band as Home's headline is. */
  pageTitles: ['plain', 'band'],
  /** The pages whose titles a design can word. */
  titledPage: ['roadmap', 'changelog', 'help', 'support'],
  /** Home's composer: a block on the grid, or in the band under the headline. */
  composerPlace: ['block', 'band'],
  /** How wide Home's composer is in the band, narrowest first; full is the words' own width. */
  composerWidth: COMPOSER_WIDTHS,
  /** Home's hero's one main action: the composer, the help search, a call to action, or none. */
  mainAction: ['composer', 'search', 'button', 'none'],
  /** Where the hero's call to action goes: it opens the composer, or goes to the roadmap. */
  heroButtonTo: ['composer', 'roadmap'],
  /**
   * The page behind everything: its own colour, a soft wash of a colour, a
   * gradient, an uploaded image, or a quiet pattern.
   */
  pageBackground: ['solid', 'tint', 'gradient', 'image', 'pattern'],
  /** The pages that can have a background of their own over the site's. */
  backgroundPage: ['home', 'feedback', 'roadmap', 'changelog', 'help', 'support', 'status', 'post'],
  /** A colour a page background can be drawn in: the page's own, or one of the brand's. */
  backgroundColour: ['page', 'accent', 'support', 'extra1', 'extra2'],
  /** How strongly a wash, gradient or pattern shows. */
  backgroundStrength: ['faint', 'soft', 'strong'],
  /** A gradient in a line, or a glow out from a point. */
  gradientShape: ['linear', 'radial'],
  /** Which way a line gradient runs: from its first colour toward its last. */
  gradientDirection: ['down', 'up', 'right', 'left', 'diagonal'],
  /** Where a glow starts. */
  gradientCentre: ['top', 'middle', 'corner'],
  /** How an image fills the page: covering it, whole within it, or repeated. */
  backgroundFit: ['cover', 'contain', 'tile'],
  /** Which part of an image stays in view. */
  backgroundPosition: ['top', 'centre', 'bottom'],
  /** An image scrolling with the page, or held still behind it (on larger screens only). */
  backgroundScroll: ['scroll', 'fixed'],
  /** A pattern's motif. */
  pattern: ['dots', 'grid', 'lines', 'cross'],
  /** How large a pattern's motif is drawn. */
  patternScale: ['small', 'medium', 'large'],
  /** `filled` cards have no edge: their own colour on the page, with larger corners. */
  cards: ['bordered', 'raised', 'list', 'filled'],
  /** What tints the vote box and the current menu item: the neutral raised colour, or the second colour. */
  tint: ['neutral', 'support'],
  /** The colour of the band's call to action: as the other buttons, the brand colour, or the second. */
  action: ['buttons', 'accent', 'support'],
  /** What fills a primary button: the brand colour, or the text colour, as many brands' black buttons are. */
  fill: ['accent', 'ink'],
  density: ['compact', 'comfortable', 'spacious'],
  width: ['narrow', 'default', 'wide'],
  /** Which side of the feed the filters sit on, `end` being the reading end. */
  filters: ['end', 'start'],
  sort: ['trending', 'top', 'new'],
  blockType: [
    'welcome',
    'composer',
    'ideas',
    'roadmap',
    'updates',
    'help_search',
    'help_topics',
    'status',
    'contact',
    'links',
  ],
  /** A Home block's own look: the site's card, no card, a tint of the brand colour, or the brand colour. */
  blockTone: ['card', 'plain', 'tint', 'brand'],
  blockAlign: ['start', 'centre'],
  /** What a post card shows besides its title and votes. */
  postCardField: ['excerpt', 'tags', 'meta'],
  /** The changelog's entries: dates in a column beside them, each in a card, or titles alone. */
  changelogEntries: ['timeline', 'cards', 'compact'],
  /** An entry's featured image on the changelog: left off, across the entry, or small beside it. */
  entryImage: ['none', 'wide', 'thumbnail'],
  /** Where a page title's own button sits: beside the title, or under its words. */
  titleAction: ['beside', 'under'],
  /** The help center's topics: cards in a grid, or a list. */
  helpTopics: ['cards', 'list'],
  /** How large the help center's search is. */
  searchSize: ['standard', 'large'],
  /** The roadmap's board: a column per status, or one list grouped by status. */
  roadmapBoard: ['columns', 'list'],
} as const

export type DesignOption = keyof typeof DESIGN_OPTIONS

/**
 * Fonts a design can use without uploading files: the families the portal
 * self-hosts, plus IBM Plex Sans, Fraunces and Bricolage Grotesque for the
 * presets and reference designs, and the system monospace stack.
 */
export const BUNDLED_FONT_IDS = [
  'inter',
  'system',
  'roboto',
  'open-sans',
  'lato',
  'nunito',
  'poppins',
  'dm-sans',
  'jakarta',
  'geist',
  'manrope',
  'space-grotesk',
  'playfair',
  'merriweather',
  'lora',
  'fira-code',
  'jetbrains',
  'ibm-plex-sans',
  'fraunces',
  'bricolage-grotesque',
  'inter-tight',
  'sora',
  'outfit',
  'figtree',
  'work-sans',
  'instrument-sans',
  'noto-sans',
  'rubik',
  'karla',
  'libre-franklin',
  'barlow-condensed',
  'oswald',
  'source-serif',
  'archivo',
  'unbounded',
  'roboto-slab',
  'bodoni-moda',
  'quicksand',
  'mona-sans',
  'hanken-grotesk',
  'system-mono',
] as const
export type BlockType = (typeof DESIGN_OPTIONS.blockType)[number]

/**
 * Each Home block's size on the twelve-column grid, in columns and rows: the
 * size a new one takes, and the least it can be made. One row is as tall as
 * the block's content, so a block never shows blank space it did not ask
 * for; more rows make it taller than its content.
 */
export const BLOCK_SIZES: Record<
  BlockType,
  { readonly size: readonly [w: number, h: number]; readonly min: readonly [w: number, h: number] }
> = {
  welcome: { size: [12, 1], min: [3, 1] },
  composer: { size: [12, 1], min: [4, 1] },
  ideas: { size: [6, 1], min: [4, 1] },
  roadmap: { size: [12, 1], min: [6, 1] },
  updates: { size: [6, 1], min: [4, 1] },
  help_search: { size: [6, 1], min: [4, 1] },
  help_topics: { size: [12, 1], min: [4, 1] },
  status: { size: [4, 1], min: [3, 1] },
  contact: { size: [4, 1], min: [3, 1] },
  links: { size: [4, 1], min: [3, 1] },
}
