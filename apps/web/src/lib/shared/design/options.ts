/**
 * Every choice a portal design offers, in one place. The design schema, the
 * reference-brand coverage test and Appearance's tiles all read these lists,
 * so an option added here is offered, validated and tested together.
 */
export const DESIGN_OPTIONS = {
  /** `auto` follows the visitor's device. */
  mode: ['light', 'dark', 'auto'],
  corners: ['sharp', 'subtle', 'rounded', 'pill'],
  headingWeight: [500, 600, 700, 800],
  fontKind: ['bundled', 'uploaded'],
  logoDisplay: ['mark_and_name', 'mark', 'wordmark'],
  header: ['stacked', 'inline', 'centered'],
  nav: ['tabs', 'underline', 'pills'],
  band: ['none', 'tint', 'fade', 'brand'],
  cards: ['bordered', 'raised', 'list'],
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
  contact: ['third', 'half'],
  links: ['third', 'half'],
}
