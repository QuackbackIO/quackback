/**
 * The rows of the builder's hand-drawn panels, each with a stable name and
 * the label it shows: Theme's sections in their order, the logo's, the
 * header's, the hero's, the feed's parts and the page's own. A panel draws
 * each row with `find={FIND.<row>.id}` and its label from here, and quick
 * find's index (find-index.ts) is generated from the same tables, so an
 * entry always leads to a row that is drawn. Element rows come from the
 * element registry (element-rows.ts), and Home blocks' from the block
 * registry.
 */
import { heroSettingShown, type HeroKey } from '@/lib/shared/design/hero'
import { HEADER_COPY } from '@/lib/shared/design/menu-actions'
import type { DesignerPage, Selection } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { fontWeights } from '@/lib/shared/design/fonts'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { BLOCK_WORDS, COLOUR_NAMES, FONT_NAMES, HERO_WORDS, THEME, WORDS } from './properties/words'

/** A row: its stable name (`data-find` on the row drawn), its label, and other words for it. */
export interface FindRow {
  id: string
  label: string
  terms?: string
}

/** What decides whether a row is drawn: the design, the pages that are on, the page it is on. */
export interface FindContext {
  design: PortalDesign
  gates: PortalPageGates
  page: DesignerPage
}

export interface PanelRow extends FindRow {
  /** Whether the panel draws it, where it does not always. */
  when?: (at: FindContext) => boolean
  /** The pages it is drawn on, where not on every page its panel is. */
  pages?: readonly DesignerPage[]
  /** A disclosure to open first, by the `data-find-open` on its button. */
  opens?: string
}

export interface PanelSection {
  title?: string
  rows: readonly PanelRow[]
}

/** A panel's rows: where it is ('theme', a part's pick, or null for the page's own), its name, its sections. */
export interface FindPanel {
  place: 'theme' | Selection | null
  name: string
  sections: readonly PanelSection[]
}

/** The pages whose title can sit plain or in a hero, as Home's and Feedback's always do. */
export const TITLED: readonly DesignerPage[] = ['roadmap', 'changelog', 'help', 'support']

/** The heading weights the heading font has: Fonts draws them as tiles when there are two or more. */
export const headingWeightsOf = (design: PortalDesign) =>
  DESIGN_OPTIONS.headingWeight.filter((weight) =>
    fontWeights(design.brand.fonts.heading).includes(weight)
  )

const row = (id: string, label: string, terms?: string): FindRow => ({ id, label, terms })

/** Every hand-drawn row's stable name and label, as its panel draws it. */
export const FIND = {
  // Theme › Brand kit
  icon: row('logo-icon', THEME.icon, 'logo mark square'),
  title: row('logo-title', THEME.title, 'logo name wordmark'),
  // Theme › Colours
  accent: row('kit-accent', COLOUR_NAMES.accent, 'primary accent main colour color'),
  support: row('kit-support', COLOUR_NAMES.support, 'secondary accent colour color'),
  ink: row('kit-ink', COLOUR_NAMES.ink, 'text colour color'),
  pageColour: row('kit-background', COLOUR_NAMES.page, 'page background colour color'),
  surface: row('kit-surface', COLOUR_NAMES.surface, 'card surface colour color'),
  raised: row('kit-raised', COLOUR_NAMES.raised, 'raised colour color'),
  muted: row('kit-muted', COLOUR_NAMES.muted, 'muted grey text colour color'),
  border: row('kit-border', COLOUR_NAMES.border, 'border edge colour color'),
  darkMode: row('kit-dark', THEME.darkMode, 'dark colours night'),
  // Theme › Fonts
  pair: row('kit-font-pair', THEME.pair, 'font pairing typeface'),
  headingFont: row('kit-font-heading', FONT_NAMES.heading, 'typeface family'),
  headlineFont: row('kit-font-display', FONT_NAMES.headline, 'typeface family display'),
  bodyFont: row('kit-font-body', FONT_NAMES.body, 'typeface family text'),
  headingWeight: row('kit-heading-weight', THEME.headingWeight, 'bold font'),
  // Theme › Style
  look: row('theme-look', THEME.look, 'looks preset start'),
  corners: row('theme-corners', 'Corners', 'radius rounded'),
  appearance: row('theme-appearance', THEME.appearance, 'light dark auto mode'),
  pageWidth: row('theme-width', THEME.pageWidth, 'narrow wide'),
  hover: row('theme-hover', THEME.hover, 'motion lift arrow'),
  background: row('theme-background', THEME.background, 'page background gradient tint'),
  // Theme › Site images
  favicon: row('kit-favicon', THEME.favicon, 'tab icon'),
  shareImage: row('kit-share-image', THEME.shareImage, 'social link preview og'),
  // Theme › Advanced
  customCss: row('theme-css', THEME.customCss, 'stylesheet code'),
  // Logo
  fullLogo: row('logo-full', THEME.fullLogo, 'wordmark image'),
  logoImage: row('logo-image', THEME.image, 'wordmark full logo file'),
  logoHeight: row('logo-height', THEME.height, 'size'),
  logoColours: row('logo-colours', THEME.logoColours, 'status markers colors'),
  // Header and menu
  headerLayout: row('header-layout', HEADER_COPY.layout, 'header inline centred stacked'),
  menuPosition: row('header-menu-position', 'Menu position', 'align centre'),
  headerBlend: row('header-blend', 'Blend into hero', 'header band'),
  menu: row('header-menu', HEADER_COPY.menu, 'links navigation pages'),
  landing: row('header-landing', HEADER_COPY.land, 'home first page'),
  // Hero
  heroLook: row('hero-look', HERO_WORDS.look, 'band banner'),
  heroColour: row('hero-colour', HERO_WORDS.colour, 'band colour color'),
  heroArt: row('hero-art', HERO_WORDS.art, 'pattern dots waves'),
  heroHeight: row('hero-height', HERO_WORDS.height, 'tall short'),
  heroAlign: row('hero-align', HERO_WORDS.align, 'centre left'),
  heroShape: row('hero-shape', HERO_WORDS.shape, 'inset split full'),
  heroImage: row('hero-image', HERO_WORDS.image, 'photo picture'),
  heroPhones: row('hero-phones', HERO_WORDS.phones, 'mobile image'),
  mainAction: row('hero-main-action', HERO_WORDS.mainAction, 'composer button'),
  composerWidth: row('hero-composer-width', HERO_WORDS.composerWidth, 'composer'),
  goesTo: row('hero-goes-to', HERO_WORDS.goesTo, 'button link'),
  secondButton: row('hero-second-button', HERO_WORDS.secondButton, 'button'),
  buttonColour: row('hero-button-colour', HERO_WORDS.buttonColour, 'call to action colour color'),
  glow: row('hero-glow', HERO_WORDS.glow),
  blend: row('hero-blend', HERO_WORDS.blend),
  fadeFrom: row('hero-fade-from', HERO_WORDS.fadeFrom, 'fade'),
  otherPages: row('hero-other-pages', HERO_WORDS.otherPages, 'page titles'),
  heroFill: row('hero-fill', HERO_WORDS.fillAndEdge, 'background border shadow corners'),
  // The page's own background, in the page's panel and the hero's
  pageBackground: row('page-background', WORDS.background, 'page background'),
  // Feedback's parts
  welcome: row('welcome-show', WORDS.show, 'welcome message intro'),
  prompt: row('feed-words-prompt', 'Prompt', 'composer words placeholder'),
  submit: row('feed-words-submit', 'Button', 'composer submit post words'),
  sort: row('feed-sort', 'Sort', 'default order trending top new'),
  previewEmpty: row('feed-preview-empty', 'Preview empty', 'no posts'),
  emptyTitle: row('feed-words-emptyTitle', 'Title', 'empty no posts words'),
  excerpt: row('feed-card-excerpt', 'Excerpt', 'post card line'),
  tags: row('feed-card-tags', 'Tags', 'post card'),
  details: row('feed-card-meta', 'Details', 'post card author date comments'),
  filtersSide: row('filters-side', 'Side', 'left right sidebar'),
  // A Home block's own
  blockWidth: row('block-width', BLOCK_WORDS.width, 'size columns layout'),
  blockBackground: row('block-background', BLOCK_WORDS.background, 'card plain tint brand look'),
  // The page's own
  pageTitle: row('page-title', WORDS.pageTitle, 'page title hero plain'),
  subscribe: row('page-subscribe', 'Subscribe', 'email'),
  search: row('page-search', 'Search', 'search size'),
} as const satisfies Record<string, FindRow>

/** A block registry setting's stable name, in a Home block's or a page section's panel. */
export const blockFieldFind = (key: string) => `block-field-${key}`

/** The name on Theme's Advanced button, which find opens for the rows under it. */
export const ADVANCED_OPEN = 'theme-advanced'

const heroShown =
  (key: HeroKey) =>
  ({ design, page }: FindContext) =>
    heroSettingShown(key, design, page)
const hasHeroImage = ({ design }: FindContext) => !!design.brand.bandImage

/** Theme's sections, in the order Theme draws them; its Elements are the element registry's. */
export const THEME_PANEL: FindPanel = {
  place: 'theme',
  name: WORDS.theme,
  sections: [
    { title: THEME.sections.brandKit, rows: [FIND.icon, FIND.title] },
    {
      title: THEME.sections.colours,
      rows: [
        FIND.accent,
        { ...FIND.support, when: ({ design }) => !!design.brand.light.support },
        FIND.ink,
        FIND.pageColour,
        FIND.surface,
        FIND.raised,
        FIND.muted,
        FIND.border,
        { ...FIND.darkMode, when: ({ design }) => design.mode !== 'light' },
      ],
    },
    {
      title: THEME.sections.fonts,
      rows: [
        FIND.pair,
        FIND.headingFont,
        FIND.headlineFont,
        FIND.bodyFont,
        { ...FIND.headingWeight, when: ({ design }) => headingWeightsOf(design).length > 1 },
      ],
    },
    {
      title: THEME.sections.style,
      rows: [FIND.look, FIND.corners, FIND.appearance, FIND.pageWidth, FIND.hover, FIND.background],
    },
    { title: THEME.sections.siteImages, rows: [FIND.favicon, FIND.shareImage] },
    { title: THEME.sections.advanced, rows: [{ ...FIND.customCss, opens: ADVANCED_OPEN }] },
  ],
}

/** The panels of the parts, each where its part is picked. */
export const PART_PANELS: readonly FindPanel[] = [
  {
    place: 'logo',
    name: WORDS.logo,
    sections: [
      {
        rows: [
          FIND.fullLogo,
          { ...FIND.logoImage, when: ({ design }) => design.brand.logo.display === 'wordmark' },
          { ...FIND.logoHeight, when: ({ design }) => design.brand.logo.display !== 'name' },
        ],
      },
      { title: THEME.sections.colours, rows: [FIND.logoColours] },
    ],
  },
  {
    place: 'header',
    name: HEADER_COPY.title,
    sections: [
      {
        title: HEADER_COPY.layout,
        rows: [
          FIND.headerLayout,
          { ...FIND.menuPosition, when: ({ design }) => design.layout.header === 'inline' },
          { ...FIND.headerBlend, when: ({ design }) => design.layout.band !== 'none' },
        ],
      },
      { title: HEADER_COPY.menu, rows: [FIND.menu, FIND.landing] },
    ],
  },
  {
    place: 'hero',
    name: 'Hero',
    sections: [
      {
        title: HERO_WORDS.look,
        rows: [
          FIND.heroLook,
          { ...FIND.heroColour, when: heroShown('colour') },
          { ...FIND.heroArt, when: heroShown('art') },
        ],
      },
      { title: HERO_WORDS.layout, rows: [FIND.heroHeight, FIND.heroAlign, FIND.heroShape] },
      {
        title: HERO_WORDS.image,
        rows: [
          { ...FIND.heroImage, when: hasHeroImage },
          { ...FIND.heroPhones, when: hasHeroImage },
        ],
      },
      {
        title: HERO_WORDS.mainAction,
        rows: [
          { ...FIND.mainAction, pages: ['home'] },
          { ...FIND.composerWidth, pages: ['home'], when: heroShown('composerWidth') },
          { ...FIND.goesTo, pages: ['home'], when: heroShown('buttonTo') },
          { ...FIND.secondButton, pages: ['home'], when: heroShown('secondButton') },
          { ...FIND.buttonColour, pages: ['home'], when: heroShown('action') },
        ],
      },
      {
        rows: [
          { ...FIND.glow, when: heroShown('glow') },
          { ...FIND.blend, when: heroShown('blend') },
          { ...FIND.fadeFrom, when: heroShown('fadeFrom') },
          FIND.otherPages,
          FIND.heroFill,
        ],
      },
    ],
  },
  { place: 'welcome', name: 'Welcome message', sections: [{ rows: [FIND.welcome] }] },
  {
    place: 'composer',
    name: 'Composer',
    sections: [{ title: WORDS.words, rows: [FIND.prompt, FIND.submit] }],
  },
  {
    place: 'feed',
    name: 'Feed',
    sections: [
      { title: 'Posts', rows: [FIND.sort] },
      { title: 'When empty', rows: [FIND.previewEmpty, FIND.emptyTitle] },
      { title: 'Post cards', rows: [FIND.excerpt, FIND.tags, FIND.details] },
    ],
  },
  { place: 'filters', name: 'Filters', sections: [{ rows: [FIND.filtersSide] }] },
]

/** The page's own panel, shown with nothing picked. */
export const PAGE_PANEL: FindPanel = {
  place: null,
  name: WORDS.page,
  sections: [
    {
      rows: [
        { ...FIND.pageTitle, pages: TITLED },
        { ...FIND.subscribe, pages: ['changelog'] },
        { ...FIND.search, pages: ['help'] },
        FIND.pageBackground,
      ],
    },
  ],
}
