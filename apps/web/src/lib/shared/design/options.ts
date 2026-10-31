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
  headingWeight: [500, 600, 700, 800],
  fontKind: ['bundled', 'uploaded'],
  /** `name` sets the workspace name in the heading font, a wordmark without a file. */
  logoDisplay: ['mark_and_name', 'mark', 'wordmark', 'name'],
  /** A wordmark file's ink, so it can turn light on a dark header and dark on a light one. */
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
  headlineAccent: ['colour', 'highlight'],
  header: ['stacked', 'inline', 'centered'],
  nav: ['tabs', 'underline', 'pills'],
  /** `support` fills with the second brand colour; `blend` runs the two together. */
  band: ['none', 'tint', 'fade', 'brand', 'support', 'blend'],
  /** How a blend band runs: in a line, or as a soft mesh beside the words. */
  blend: ['linear', 'mesh'],
  /** Where the band's words sit. */
  bandAlign: ['left', 'centre'],
  /** The band across the page, as a rounded panel within it, or with its words on a panel. */
  bandShape: ['full', 'inset', 'panel'],
  /** Where the band's image sits: beside the words, along its bottom, behind them, or tiled. */
  imagePlace: ['side', 'edge', 'cover', 'pattern'],
  /** Quiet art drawn in the brand's colours, for a band without an image. */
  bandArt: ['none', 'dots', 'grid', 'lines', 'waves', 'hills', 'petals', 'confetti'],
  /** Where an image is cropped toward when it does not fit. */
  imageFocus: ['left', 'centre', 'right'],
  /** Home's composer: a block on the grid, or in the band under the headline. */
  composerPlace: ['block', 'band'],
  /** `filled` cards have no edge: their own colour on the page, with larger corners. */
  cards: ['bordered', 'raised', 'list', 'filled'],
  /** What tints the vote box and the current menu item: the neutral raised colour, or the second colour. */
  tint: ['neutral', 'support'],
  /** The colour of the band's call to action. */
  action: ['accent', 'support'],
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
  /** A share of Home's six-column grid. */
  blockWidth: ['third', 'half', 'two_thirds', 'full'],
  /** What visitors call what they post. */
  postWord: ['idea', 'post', 'feature_request', 'suggestion'],
  /** What visitors call the groups posts sit in. */
  boardWord: ['board', 'category'],
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
  'system-mono',
] as const
export type BlockType = (typeof DESIGN_OPTIONS.blockType)[number]
export type BlockWidth = (typeof DESIGN_OPTIONS.blockWidth)[number]

/** The widths each Home block can take. */
export const BLOCK_WIDTHS: Record<BlockType, readonly BlockWidth[]> = {
  welcome: ['half', 'two_thirds', 'full'],
  composer: ['half', 'two_thirds', 'full'],
  ideas: ['third', 'half', 'two_thirds'],
  roadmap: ['two_thirds', 'full'],
  updates: ['third', 'half', 'two_thirds', 'full'],
  help_search: ['half', 'two_thirds', 'full'],
  help_topics: ['half', 'two_thirds', 'full'],
  status: ['third', 'half'],
  contact: ['third', 'half', 'full'],
  links: ['third', 'half'],
}
