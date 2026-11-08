/**
 * One word for each idea, across every properties panel. Panels import these
 * rather than writing their own, so the same thing is never called two
 * names. A panel moves its strings here as it moves onto the properties
 * frame; what is not here yet is still each panel's own.
 */
import { MENU_WORDS } from '@/lib/shared/design/menu-words'
import type { ColourRoleName } from '@/lib/shared/design/style-tokens'

export const WORDS = {
  /** A one-off: the narrowest scope, a single registered part. */
  justThisOne: 'Just this one',
  thisBlock: 'This block',
  thisPage: 'This page',
  /** The places a wider change does not reach, in the overrides footer. */
  setDifferently: 'Set differently',
  /** Going back to the wider value. */
  reset: 'Reset',
  more: 'More',
  /** The brand sheet. */
  theme: 'Theme',
  fonts: 'Fonts',
  /** The right-hand panel. */
  properties: 'Properties',
  duplicate: 'Duplicate',
  /** A colour's popover tabs. */
  brand: 'Brand',
  custom: 'Custom',
  light: 'Light',
  dark: 'Dark',
  /** Sources a value can come from, on hover. */
  fromBrand: 'From brand',
  /** A brand value that is an exact value, not a choice's. */
  fromExact: 'From brand, set exactly',
  /** A choice an exact value takes the place of, on hover. */
  setExactly: 'Set exactly: pick one to use it',
  /** The panel's menu: clears an element's exact values. */
  resetExact: 'Reset exact values',
  /** Corner steps, sharpest first. */
  corners: { sharp: 'Sharp', soft: 'Soft', round: 'Round', pill: 'Pill' },
  /** Letter case. */
  capitals: 'Capitals',
  alignment: { start: 'Start', centre: 'Centre', end: 'End' },
  /** Words that are neither a heading nor a list. */
  paragraph: 'Paragraph',
  /** The page's own panel, with nothing picked. */
  page: 'Page',
  onThisPage: 'On this page',
  everyPage: 'Every page',
  words: 'Words',
  /** The header's logo, its own element. */
  logo: 'Logo',
  pageTitle: 'Title',
  titlePlain: 'Plain',
  titleInHero: 'In the hero',
  titledPages: 'The roadmap, changelog, help and support pages',
  background: 'Background',
  width: 'Width',
  setInTheme: 'Set in Theme',
  /** The menu's words, shared with its steps' undo labels. */
  ...MENU_WORDS,
  /** A value worked out for you until set. */
  auto: 'Auto',
  none: 'None',
} as const

/** The corner steps by their stored ids, as every corners control names them. */
export const CORNER_NAMES = {
  sharp: WORDS.corners.sharp,
  subtle: WORDS.corners.soft,
  rounded: WORDS.corners.round,
  pill: WORDS.corners.pill,
} as const

/** The Theme sheet's words: its sections, rows and the few verbs on them. */
export const THEME = {
  sections: {
    brandKit: 'Brand kit',
    colours: 'Colours',
    fonts: 'Fonts',
    style: 'Style',
    pageBackground: 'Page background',
    elements: 'Elements',
    siteImages: 'Site images',
    advanced: 'Advanced',
  },
  background: 'Background',
  pageWidth: 'Page width',
  widths: { narrow: 'Narrow', default: 'Standard', wide: 'Wide' },
  hover: 'Hover',
  hovers: { none: 'None', lift: 'Lift', arrow: 'Arrow' },
  customCss: 'Custom CSS',
  /** The brand kit's way to the logo as the header draws it. */
  sizeAndPlacement: 'Size and placement',
  height: 'Height',
  icon: 'Icon',
  title: 'Title',
  titlePlaceholder: 'Workspace name',
  /** Where an icon comes from while the portal has none of its own. */
  workspaceLogo: 'Workspace logo',
  /** The draft note, as hover help on the icon rather than a paragraph. */
  draftNote: 'Admin and emails keep the workspace logo',
  readable: 'Every pair reads well',
  hardToRead: (n: number) => (n === 1 ? '1 pair is hard to read' : `${n} pairs are hard to read`),
  hardOn: (on: string) => `Hard to read on ${on}`,
  fix: 'Fix',
  addColour: 'Add colour',
  darkMode: 'Dark mode',
  resetAllToAuto: 'Reset all to auto',
  custom: 'Custom',
  logoColours: 'Logo colours',
  pickFromLogo: 'Pick from logo',
  logoColoursHelp: 'Used by status markers in brand style',
  fromLogo: 'From your logo',
  useAsBrand: (colour: string) => `Use ${colour} as brand colour`,
  brandFromLogo: 'Brand colour from your logo',
  reading: 'Reading…',
  clear: 'Clear',
  pair: 'Pair',
  headingWeight: 'Heading weight',
  sameAsHeading: 'Same as heading',
  look: 'Look',
  looks: 'Looks',
  /** A look's second action: take its colours and fonts as well as its treatment. */
  useItsColours: 'Use its colours too',
  lookStep: (name: string) => `Look: ${name}`,
  lookAndColoursStep: (name: string) => `Look and colours: ${name}`,
  appearance: 'Appearance',
  appearances: { light: 'Light', dark: 'Dark', auto: 'Auto' },
  autoHelp: 'Auto follows the visitor’s device',
  everyPage: 'Every page',
  justPage: (page: string) => `Just ${page}`,
  pageOnly: (page: string) => `${page} only`,
  favicon: 'Favicon',
  fromIcon: 'From icon',
  shareImage: 'Share image',
  automatic: 'Automatic',
  fullLogo: 'Full logo',
  fullLogoSwitch: 'Use a full logo image instead',
  fullLogoEmpty: 'Shows icon and title',
  upload: 'Upload',
  replace: 'Replace',
  uploading: 'Uploading…',
  /** A background's rows. */
  kind: 'Fill',
  colour: 'Colour',
  strength: 'Strength',
  asChosen: 'As chosen',
  stop: (n: number) => `Stop ${n}`,
  addStop: 'Add stop',
  removeStop: 'Remove stop',
  image: 'Image',
  imageStrength: 'Image strength',
  shownAt: (n: number) => `Shown at ${n}% to keep text readable`,
  darkFill: { auto: 'Auto', plain: 'Page', own: 'Own' },
  darkBackground: 'Dark background',
  /** View options. */
  previewAs: 'Preview as',
  visitor: 'Visitor',
  signedOut: 'Signed out',
  signedIn: 'Signed in',
  language: 'Language',
  viewHelp: 'Only you see this',
  keyboardShortcuts: 'Keyboard shortcuts',
} as const

/**
 * Each colour role's name, as a chip shows it. The one table for role names:
 * a colour field, a swatch's label and a source line all read it.
 */
export const COLOUR_NAMES: Record<ColourRoleName, string> = {
  accent: 'Brand colour',
  support: 'Second colour',
  extra1: 'Extra colour 1',
  extra2: 'Extra colour 2',
  ink: 'Text',
  muted: 'Secondary text',
  page: 'Page',
  surface: 'Cards',
  raised: 'Raised',
  border: 'Borders',
  'accent-text': 'Brand text',
  'on-accent': 'Text on brand',
  white: 'White',
  black: 'Black',
  transparent: 'None',
}

/** The brand's font slots, as a font chip shows them. */
export const FONT_NAMES = {
  heading: 'Heading font',
  headline: 'Headline font',
  body: 'Body font',
} as const

/** "Changing every main button", from one of the kind, such as "Main button". */
export const everyOf = (one: string) => `every ${one.toLowerCase()}`

/** "Back to every main button". */
export const backToEvery = (one: string) => `Back to ${everyOf(one)}`

/** What Reset goes back to, as its tooltip says: "Reset to 8 px from brand". */
export const resetTo = (value: string, from: string) =>
  `Reset to ${value} ${from.charAt(0).toLowerCase()}${from.slice(1)}`

/** "Set differently in 1 place", "Set differently in 3 places". */
export const setDifferentlyIn = (n: number) =>
  `${WORDS.setDifferently} in ${n} ${n === 1 ? 'place' : 'places'}`

/** A detached value's way back: "Link to Brand colour". */
export const linkTo = (name: string) => `Link to ${name}`

/** A source, on hover: "From every main button", "From this page". */
export const fromScope = (scope: string) => `From ${scope.charAt(0).toLowerCase()}${scope.slice(1)}`

/** Short names for a style's few-way choices, as tiles show them. */
export const CHOICE_TILES = {
  borderStyle: { solid: 'Solid', dashed: 'Dashes', dotted: 'Dots', none: 'None' },
  shadow: {
    none: 'None',
    soft: 'Soft',
    lifted: 'Lifted',
    floating: 'Floating',
    deep: 'Deep',
    glow: 'Glow',
  },
  case: { none: 'Aa', upper: 'AA', lower: 'aa', capitalize: 'Ab' },
  underline: { none: 'None', underline: 'Underline' },
} as const

/**
 * The brand's choices an element's Style section offers, as tiles show
 * them. Colours say their role's name from the one table.
 */
export const STYLE_CHOICES = {
  buttonShape: { match: 'Match', square: 'Sharp', rounded: 'Round', pill: 'Pill' },
  fill: { accent: COLOUR_NAMES.accent, ink: COLOUR_NAMES.ink },
  capitals: { sentence: 'As written', upper: 'Capitals' },
  scale: { standard: 'Standard', large: 'Large', display: 'Display' },
  spacing: { normal: 'Normal', tight: 'Tight' },
  menu: { tabs: 'Tabs', underline: 'Underline', pills: 'Pills', plain: 'Plain' },
  menuText: { muted: 'Grey', ink: COLOUR_NAMES.ink },
  tint: { neutral: 'Neutral', support: COLOUR_NAMES.support },
  cards: { bordered: 'Outline', raised: 'Raised', list: 'Rows', filled: 'Filled' },
  density: { compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' },
  status: { colour: 'Dot', ink: COLOUR_NAMES.ink, pill: 'Tag', brand: 'Logo colours' },
  secondary: { outline: 'Outline', tint: 'Tint', text: 'Text only' },
} as const

/** The element panel's sections, by title. */
export const SECTIONS = {
  /** The brand's choices for the element, at its widest scope. */
  style: 'Style',
  fill: 'Fill',
  text: 'Text',
  shape: 'Shape',
  edge: 'Edge',
  shadow: 'Shadow',
  lift: 'Lift',
  focusRing: 'Focus ring',
} as const

/** What a picked thing is, beside its title: a block on a page, and an element inside one. */
export const KINDS = { block: 'Block', element: 'Element' } as const

/** A block's own actions, in its panel's ⋯ menu and in Find. */
export const BLOCK_ACTIONS = {
  duplicate: WORDS.duplicate,
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
} as const

/** A block panel's sections, by title. */
export const BLOCK_SECTIONS = {
  words: 'Words',
  content: 'Content',
  layout: 'Layout',
  look: 'Look',
} as const

/** A block panel's rows and their few words. */
export const BLOCK_WORDS = {
  heading: 'Heading',
  link: 'Link',
  message: 'Message',
  edit: 'Edit',
  editHere: 'Edit here',
  add: 'Add',
  none: 'None',
  /** A message the canvas cannot edit where it sits. */
  holdsMore: 'Has images or tables',
  width: 'Width',
  column: 'Column',
  row: 'Row',
  height: 'Height',
  /** On a phone, in place of Layout's rows. */
  stacks: 'Stacks in reading order',
  background: 'Background',
  colour: 'Colour',
  align: 'Align',
  element: 'Element',
  homeBlock: 'Home block',
} as const

/** A Home block's backgrounds, as tiles show them. */
export const BLOCK_TONES = { card: 'Card', plain: 'Plain', tint: 'Tint', brand: 'Brand' } as const

/** What Reset goes back to, where it comes from nowhere wider: "Reset to auto". */
export const resetToValue = (value: string) => `${WORDS.reset} to ${value}`

/** Cropping a logo from a screenshot. */
export const CROP = {
  logo: 'Logo',
  crop: 'Crop',
  hint: 'Drag to move, corner to size, arrows to nudge',
} as const

/** The hero's looks, named for their treatment; the colour they draw in is the Colour row's. */
export const HERO_LOOKS: Record<string, string> = {
  plain: 'Plain',
  tint: 'Tint',
  fade: 'Fade',
  brand: 'Bold',
  'brand-waves': 'Bold waves',
  inset: 'Bold panel',
  second: 'Second',
  blend: 'Blend',
}

/** The hero panel's sections, rows and few words. */
export const HERO_WORDS = {
  /** The scope line: "Changing the hero on every page (6) · Just this page". */
  everyPage: 'the hero on every page',
  justThisPage: 'Just this page',
  justThisPagePhrase: 'the hero on just this page',
  /** Why only Home's hero can be narrowed: its image is the one thing a page can keep. */
  onlyHome: 'Only Home can keep an image of its own',
  look: 'Look',
  colour: 'Colour',
  art: 'Art',
  layout: 'Layout',
  height: 'Height',
  align: 'Align',
  shape: 'Shape',
  image: 'Image',
  sits: 'Sits',
  focalPoint: 'Focal point',
  phones: 'Phones',
  altText: 'Alt text',
  decorative: 'Decorative',
  screenshot: 'Screenshot',
  mainAction: 'Main action',
  composerWidth: 'Width',
  goesTo: 'Goes to',
  secondButton: 'Second button',
  buttonColour: 'Button colour',
  glow: 'Glow',
  blend: 'Blend',
  fadeFrom: 'Fade from',
  otherPages: 'Other pages',
  fillAndEdge: 'Fill and edge',
  /** A summary row's value: as the brand has it, or set here. */
  asBrand: WORDS.brand,
  set: 'Set',
  title: WORDS.pageTitle,
  none: 'None',
  replace: 'Replace',
  upload: 'Upload',
  uploading: 'Uploading…',
  remove: 'Remove image',
  everyPageAgain: 'Reset to every page',
  /** Hover help, kept out of the normal state. */
  imageHelp:
    'A photo or pattern works best. Words or a logo in the image repeat the header and crop badly on phones.',
  altHelp: 'What the image shows, for people who cannot see it. Decorative images need none.',
  focalHelp: 'Click the image or use the arrow keys to choose what stays in view.',
  customLook: 'A custom look. Pick one to replace it.',
  plainHere:
    'This page’s title sits plain. Put other pages’ titles in the hero to show its look here.',
} as const

/** The hero's few-way choices, as tiles show them. */
export const HERO_TILES = {
  imagePlace: { side: 'Beside', edge: 'Bottom', cover: 'Behind', pattern: 'Tiled' },
  imagePhone: { show: WORDS.show, hide: WORDS.hide },
  glow: { none: 'None', bottom: 'Foot', top: 'Top', corner: 'Corner' },
  blend: { linear: 'Line', mesh: 'Mesh', ribbon: 'Ribbon' },
  fadeFrom: { top: 'Top', bottom: 'Foot' },
  height: { compact: 'Short', roomy: 'Roomy', tall: 'Tall' },
  align: { left: WORDS.alignment.start, centre: WORDS.alignment.centre },
  shape: { full: 'Full', inset: 'Inset', panel: 'Panel', split: 'Split' },
  titles: { plain: WORDS.titlePlain, band: WORDS.titleInHero },
  action: { buttons: 'As buttons', accent: COLOUR_NAMES.accent, support: COLOUR_NAMES.support },
} as const
