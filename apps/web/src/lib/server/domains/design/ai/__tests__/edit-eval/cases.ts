/**
 * An offline eval set for Ask AI's edits: realistic requests across Home's
 * blocks, the hero, the pages' sections, the menu and the theme, each with
 * the operations that make it and a rule for what a right answer leaves in
 * the design. A rule, not an exact document, so two layouts that both put
 * Status beside Help search both count, and nothing outside what the
 * request is about may change.
 */
import { fromUuid } from '@quackback/ids'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { heroOf } from '@/lib/shared/design/hero'
import { composerWidthOf } from '@/lib/shared/design/composer-width'
import { buttonToOf, mainActionOf } from '@/lib/shared/design/main-action'
import { landingOf, menuParts } from '@/lib/shared/design/menu'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { readingOrder } from '@/lib/shared/design/home-grid'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { findOverride } from '@/lib/shared/design/style-overrides'
import type { AiPlaces, FlatOp } from '@/lib/shared/design/design-ops'
import type { AiElementPick } from '@/lib/shared/design/apply-changes'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'
import {
  readStyleValue,
  STYLE_ELEMENTS,
  STYLE_ELEMENT_NAMES,
  type StyleProp,
} from '@/lib/shared/design/style-tokens'

const id = (prefix: 'board' | 'roadmap' | 'kb_category', n: number) =>
  fromUuid(prefix, `0190f5a8-0000-7000-8000-${String(n).padStart(12, '0')}`)

export const PLACES: AiPlaces = {
  boards: [
    { id: id('board', 1), name: 'Mobile' },
    { id: id('board', 2), name: 'Web app' },
    { id: id('board', 3), name: 'API' },
  ],
  roadmaps: [
    { id: id('roadmap', 1), name: 'Public roadmap' },
    { id: id('roadmap', 2), name: '2027 plans' },
  ],
  categories: [
    { id: id('kb_category', 1), name: 'Getting started' },
    { id: id('kb_category', 2), name: 'Billing' },
    { id: id('kb_category', 3), name: 'Integrations' },
  ],
}

export const GATES: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Acme's portal: Home on, a brand hero with waves, tall; the starter blocks plus Help search and Contact. */
export function fixtureDesign(): PortalDesign {
  const design = defaultDesign()
  design.brand.light.accent = '#4f46e5'
  design.layout.hero = 'brand'
  design.layout.heroArt = 'waves'
  design.layout.heroHeight = 'tall'
  design.nav.home = { on: true, tab: true }
  design.pages.home.headline = { title: { en: 'Acme feedback' }, subtitle: {} }
  design.pages.home.blocks = [
    {
      id: 'welcome001',
      type: 'welcome',
      body: doc('Hello from the Acme team.'),
      grid: { x: 0, y: 0, w: 12, h: 1 },
    },
    { id: 'composer01', type: 'composer', grid: { x: 0, y: 1, w: 8, h: 1 } },
    { id: 'status0001', type: 'status', grid: { x: 8, y: 1, w: 4, h: 1 } },
    {
      id: 'ideas00001',
      type: 'ideas',
      sort: 'trending',
      count: 3,
      grid: { x: 0, y: 2, w: 6, h: 1 },
    },
    { id: 'updates001', type: 'updates', count: 3, grid: { x: 6, y: 2, w: 6, h: 1 } },
    { id: 'roadmap001', type: 'roadmap', roadmapId: null, grid: { x: 0, y: 3, w: 12, h: 1 } },
    { id: 'topics0001', type: 'help_topics', categoryIds: [], grid: { x: 0, y: 4, w: 12, h: 1 } },
    { id: 'search0001', type: 'help_search', grid: { x: 0, y: 5, w: 6, h: 1 } },
    { id: 'contact001', type: 'contact', grid: { x: 6, y: 5, w: 6, h: 1 } },
  ] as PortalDesign['pages']['home']['blocks']
  return portalDesign.parse(design)
}

type Block = PortalDesign['pages']['home']['blocks'][number]
const blocks = (d: PortalDesign) =>
  readingOrder(d.pages.home.blocks.map((b) => ({ ...b.grid, b }))).map((p) => p.b)
const ofType = (d: PortalDesign, type: Block['type']) =>
  d.pages.home.blocks.filter((b) => b.type === type)
const one = (d: PortalDesign, type: Block['type']) => ofType(d, type)[0]
const sameRow = (a?: Block, b?: Block) => !!a && !!b && a.grid.y === b.grid.y
const rank = <T>(list: readonly T[], value: T) => list.indexOf(value)
const words = (value: unknown) => JSON.stringify(value ?? '').toLowerCase()

export interface EvalCase {
  name: string
  request: string
  /** A block or part picked in the builder, as the designer sends it. */
  picked?: {
    scope: 'home' | 'band' | 'header'
    blockId?: string
    /** An element picked on the canvas inside it: its kind and the part it is. */
    element?: AiElementPick
  }
  /** The operations that make it. */
  ops: FlatOp[]
  /** What a right answer leaves in the design. */
  check: (after: PortalDesign, before: PortalDesign) => boolean
  /** The fields it may change; anything else changed makes it wrong. */
  touches: readonly string[]
  /** What the portal holds before the request, where the fixture alone does not hold it. */
  fixture?: (d: PortalDesign) => void
}

/** The design a case starts from: the fixture, with what the case needs first. */
export function caseDesign(c: EvalCase): PortalDesign {
  const design = fixtureDesign()
  c.fixture?.(design)
  return portalDesign.parse(design)
}

const HOME = ['pages.home.blocks']
const HERO = [
  'layout.hero',
  'layout.blend',
  'layout.heroShape',
  'layout.heroArt',
  'layout.heroHeight',
  'layout.heroAlign',
  'layout.heroColour',
  'layout.fadeFrom',
  'layout.headerOnHero',
  'shape.action',
]

/** A background colour's lightness and hue: a role reads as the fixture's colour for it. */
const colourOf = (ref: string) => {
  const hex = ref === 'accent' ? '#4f46e5' : ref === 'page' ? '#ffffff' : ref
  if (!hex.startsWith('#') && !hex.startsWith('oklch')) return null
  return parseOklch(hex.startsWith('#') ? hexToOklch(hex) : hex)
}
const blueish = (ref: string) => {
  const c = colourOf(ref)
  return !!c && c.c > 0.015 && c.h >= 200 && c.h <= 290
}
const warmPale = (ref: string | undefined) => {
  const c = ref ? colourOf(ref) : null
  return !!c && c.l >= 0.88 && c.c > 0.008 && c.h >= 40 && c.h <= 115
}
const BACKGROUND = ['layout.background']
const OWN_BACKGROUND = ['layout.pageBackgrounds']

export const EVAL_CASES: EvalCase[] = [
  {
    name: 'top posts from a board',
    request: 'Show the 10 newest posts from the Mobile board',
    ops: [
      { op: 'set', target: 'ideas00001', key: 'sort', value: 'new' },
      { op: 'set', target: 'ideas00001', key: 'count', value: '10' },
      { op: 'set', target: 'ideas00001', key: 'boardIds', value: '["Mobile"]' },
    ],
    check: (d) => {
      const b = one(d, 'ideas') as Extract<Block, { type: 'ideas' }>
      return (
        b.sort === 'new' &&
        b.count === 10 &&
        JSON.stringify(b.boardIds) === JSON.stringify([PLACES.boards[0]!.id])
      )
    },
    touches: HOME,
  },
  {
    name: 'move help search to the top',
    request: 'Move help search to the top',
    ops: [{ op: 'move', target: 'search0001', value: 'top' }],
    check: (d) => blocks(d)[0]?.type === 'help_search',
    touches: HOME,
  },
  {
    name: 'hero calmer (picked)',
    request: 'Make it calmer',
    picked: { scope: 'band' },
    ops: [{ op: 'set', target: 'hero', key: 'look', value: 'tint' }],
    check: (d, before) => {
      const h = heroOf(d)
      const b = heroOf(before)
      // A quieter fill, whatever shape the hero takes (a pale tint inset reads as a custom look).
      const quieterLook =
        ['plain', 'tint', 'fade'].includes(h.look) ||
        ['none', 'tint', 'fade'].includes(d.layout.hero)
      const quieterSame =
        h.look === b.look &&
        (h.art === 'none' ||
          rank(DESIGN_OPTIONS.heroHeight, h.height) < rank(DESIGN_OPTIONS.heroHeight, b.height))
      return quieterLook || quieterSame || (d.layout.hero === 'brand' && h.art === 'none')
    },
    touches: HERO,
  },
  {
    name: 'rename changelog in the menu',
    request: 'Rename Changelog to What’s new',
    ops: [{ op: 'menu', target: 'changelog', key: 'rename', value: 'What’s new' }],
    check: (d) =>
      menuParts(d, GATES)
        .find((p) => p.id === 'changelog')
        ?.label.replace("'", '’') === 'What’s new',
    touches: ['nav.items'],
  },
  {
    name: 'add a roadmap block next to top posts',
    request: 'Add a roadmap block next to top posts',
    ops: [{ op: 'add', key: 'roadmap', target: 'beside:ideas00001' }],
    // Adding a second, or moving the one there, both answer it.
    check: (d) => ofType(d, 'roadmap').some((r) => sameRow(r, one(d, 'ideas'))),
    touches: HOME,
  },
  {
    name: 'hide status from the menu',
    request: 'Hide the status page from the menu',
    ops: [{ op: 'menu', target: 'status', key: 'hide' }],
    check: (d) =>
      d.nav.items.some((i) => i.type === 'status' && !i.shown) &&
      d.nav.items
        .filter((i) => i.type !== 'status')
        .every((i) => i.type === 'link' || ('shown' in i && i.shown)),
    touches: ['nav.items'],
  },
  {
    name: 'roadmap before feedback in the menu',
    request: 'Put Roadmap before Feedback in the menu',
    ops: [{ op: 'menu', target: 'roadmap', key: 'left' }],
    check: (d) => {
      const order = d.nav.items.map((i) => i.type)
      return order.indexOf('roadmap') < order.indexOf('feedback') && order.length === 6
    },
    touches: ['nav.items'],
  },
  {
    name: 'five top posts',
    request: 'Show 5 posts in top posts',
    ops: [{ op: 'set', target: 'ideas00001', key: 'count', value: '5' }],
    check: (d) => (one(d, 'ideas') as { count: number }).count === 5,
    touches: HOME,
  },
  {
    name: 'welcome words',
    request: 'Make the welcome block say: Tell us what to build next',
    ops: [{ op: 'set', target: 'welcome001', key: 'body', value: 'Tell us what to build next' }],
    check: (d) =>
      words((one(d, 'welcome') as { body: unknown }).body).includes('tell us what to build next'),
    touches: HOME,
  },
  {
    name: 'remove contact',
    request: 'Remove the contact block',
    ops: [{ op: 'remove', target: 'contact001' }],
    check: (d) => ofType(d, 'contact').length === 0 && d.pages.home.blocks.length === 8,
    touches: HOME,
  },
  {
    name: 'top posts full width',
    request: 'Make top posts full width',
    ops: [{ op: 'resize', target: 'ideas00001', value: 'full' }],
    check: (d) => one(d, 'ideas')?.grid.w === 12,
    touches: HOME,
  },
  {
    name: 'hero shorter',
    request: 'Make the hero shorter',
    ops: [{ op: 'set', target: 'hero', key: 'height', value: 'roomy' }],
    check: (d) =>
      rank(DESIGN_OPTIONS.heroHeight, heroOf(d).height) < rank(DESIGN_OPTIONS.heroHeight, 'tall'),
    touches: HERO,
  },
  {
    name: 'centre the hero',
    request: 'Centre the hero text',
    ops: [{ op: 'set', target: 'hero', key: 'align', value: 'centre' }],
    check: (d) => heroOf(d).align === 'centre',
    touches: HERO,
  },
  {
    name: 'roadmap block shows a chosen roadmap',
    request: 'Use the 2027 plans roadmap in the roadmap block',
    ops: [{ op: 'set', target: 'roadmap001', key: 'roadmapId', value: '2027 plans' }],
    check: (d) =>
      (one(d, 'roadmap') as { roadmapId: string | null }).roadmapId === PLACES.roadmaps[1]!.id,
    touches: HOME,
  },
  {
    name: 'help topics chosen',
    request: 'Only show the Billing and Integrations topics on Home',
    ops: [
      { op: 'set', target: 'topics0001', key: 'categoryIds', value: '["Billing","Integrations"]' },
    ],
    check: (d) =>
      JSON.stringify((one(d, 'help_topics') as { categoryIds: string[] }).categoryIds) ===
      JSON.stringify([PLACES.categories[1]!.id, PLACES.categories[2]!.id]),
    touches: HOME,
  },
  {
    name: 'changelog cards with wide images',
    request: 'Show changelog entries as cards with wide images',
    ops: [
      { op: 'set', target: 'changelog', key: 'entries', value: 'cards' },
      { op: 'set', target: 'changelog', key: 'images', value: 'wide' },
    ],
    check: (d) => d.pages.changelog?.entries === 'cards' && d.pages.changelog?.images === 'wide',
    touches: ['pages.changelog'],
  },
  {
    name: 'roadmap list',
    request: 'Show the roadmap page as one list instead of columns',
    ops: [{ op: 'set', target: 'roadmap', key: 'board', value: 'list' }],
    check: (d) => d.pages.roadmap?.board === 'list',
    touches: ['pages.roadmap'],
  },
  {
    name: 'bigger help search on the help center',
    request: 'Make the search box on the help center bigger',
    ops: [{ op: 'set', target: 'help', key: 'search', value: 'large' }],
    check: (d) => d.pages.help?.search === 'large',
    touches: ['pages.help'],
  },
  {
    name: 'brand colour',
    request: 'Use a dark green, #0f766e, as our brand colour',
    ops: [{ op: 'theme', key: 'accent', value: '#0f766e' }],
    check: (d) => d.brand.light.accent.toLowerCase() === '#0f766e',
    touches: ['brand.light.accent', 'brand.dark'],
  },
  {
    name: 'rounder corners',
    request: 'Rounder corners everywhere',
    ops: [{ op: 'theme', key: 'corners', value: 'pill' }],
    check: (d) =>
      rank(DESIGN_OPTIONS.corners, d.shape.corners) > rank(DESIGN_OPTIONS.corners, 'rounded'),
    touches: ['shape', 'tune'],
  },
  {
    name: 'home headline',
    request: 'Change the Home headline to Welcome to Acme feedback',
    ops: [{ op: 'words', target: 'home', key: 'title', value: 'Welcome to Acme feedback' }],
    check: (d) => d.pages.home.headline?.title.en === 'Welcome to Acme feedback',
    touches: ['pages.home.headline'],
  },
  {
    name: 'status beside help search',
    request: 'Put status beside help search',
    ops: [{ op: 'move', target: 'status0001', value: 'beside:search0001' }],
    check: (d) => sameRow(one(d, 'status'), one(d, 'help_search')),
    touches: HOME,
  },
  {
    name: 'land on the roadmap',
    request: 'Make the roadmap the first page visitors see',
    ops: [{ op: 'menu', target: 'roadmap', key: 'land' }],
    check: (d) => landingOf(d, GATES) === 'roadmap',
    touches: ['nav'],
  },
  {
    name: 'updates heading',
    request: 'Give the latest updates block the heading What we shipped',
    ops: [{ op: 'set', target: 'updates001', key: 'heading', value: 'What we shipped' }],
    check: (d) =>
      (one(d, 'updates') as { heading?: Record<string, string> }).heading?.en === 'What we shipped',
    touches: HOME,
  },
  {
    name: 'roadmap posts per column, updates without dates',
    request: 'Show 3 posts per roadmap column and hide the dates on the updates',
    ops: [
      { op: 'set', target: 'roadmap001', key: 'perColumn', value: '3' },
      { op: 'set', target: 'updates001', key: 'showDate', value: 'false' },
    ],
    check: (d) =>
      (one(d, 'roadmap') as { perColumn?: number }).perColumn === 3 &&
      (one(d, 'updates') as { showDate?: boolean }).showDate === false,
    touches: HOME,
  },
  {
    name: 'trending posts with comments, no votes',
    request: 'Turn off the votes on the trending posts and show comment counts',
    ops: [
      { op: 'set', target: 'ideas00001', key: 'showVotes', value: 'false' },
      { op: 'set', target: 'ideas00001', key: 'showComments', value: 'true' },
    ],
    check: (d) => {
      const ideas = one(d, 'ideas') as { showVotes?: boolean; showComments?: boolean }
      return ideas.showVotes === false && ideas.showComments === true
    },
    touches: HOME,
  },
  {
    name: 'links block at the bottom',
    request: 'Add a links block at the bottom with our docs: https://docs.acme.dev',
    ops: [
      {
        op: 'add',
        key: 'links',
        target: 'bottom',
        value: '{"links":[{"label":"Docs","url":"https://docs.acme.dev"}]}',
      },
    ],
    check: (d) => {
      const last = blocks(d).at(-1) as { type: string; links?: Array<{ url: string }> } | undefined
      return (
        last?.type === 'links' &&
        !!last.links?.some((l) => l.url.startsWith('https://docs.acme.dev'))
      )
    },
    touches: HOME,
  },
  {
    name: 'picked top posts wider',
    request: 'Make this wider',
    picked: { scope: 'home', blockId: 'ideas00001' },
    ops: [{ op: 'resize', target: 'ideas00001', value: 'wider' }],
    check: (d) => (one(d, 'ideas')?.grid.w ?? 0) > 6,
    touches: HOME,
  },
  {
    name: 'picked top posts by votes',
    request: 'Sort these by most votes',
    picked: { scope: 'home', blockId: 'ideas00001' },
    ops: [{ op: 'set', target: 'ideas00001', key: 'sort', value: 'top' }],
    check: (d) => (one(d, 'ideas') as { sort: string }).sort === 'top',
    touches: HOME,
  },
  {
    name: 'soft blue gradient page',
    request: 'Make the page a soft blue gradient',
    ops: [
      {
        op: 'background',
        target: 'site',
        key: 'gradient',
        value: '{"stops":["#dbeafe","page"],"direction":"down"}',
      },
    ],
    check: (d) => {
      const bg = d.layout.background
      return bg?.kind === 'gradient' && bg.stops.some(blueish)
    },
    touches: BACKGROUND,
  },
  {
    name: 'dots on the roadmap only',
    request: 'Give just the roadmap page a faint dotted pattern behind it',
    ops: [
      {
        op: 'background',
        target: 'roadmap',
        key: 'pattern',
        value: '{"pattern":"dots","strength":"faint"}',
      },
    ],
    check: (d) => {
      const own = d.layout.pageBackgrounds?.roadmap
      return own?.kind === 'pattern' && own.pattern === 'dots' && !d.layout.background
    },
    touches: OWN_BACKGROUND,
  },
  {
    name: 'warm cream page',
    request: 'Make the page background a warm cream',
    ops: [{ op: 'background', target: 'site', key: 'tint', value: '{"colour":"#fbf3e4"}' }],
    // A cream wash behind the page, or the page colour itself made cream, both answer it.
    check: (d) => {
      const bg = d.layout.background
      return (bg?.kind === 'tint' && warmPale(bg.colour)) || warmPale(d.brand.light.background)
    },
    touches: [...BACKGROUND, 'brand.light.background'],
  },
]

/**
 * Requests written after the contract and its examples, in other words than
 * any example, so a score on them is not the examples echoed back.
 */
export const HELD_OUT_CASES: EvalCase[] = [
  ...styleCases(),
  {
    // Another site's feel, asked of one picked part, is that part's look: the
    // brand (and a whole-site match) stays out of it.
    name: 'a picked hero button like another site: that button only, no brand change',
    request: 'Make this button feel like stripe.com',
    picked: { scope: 'band', element: { element: 'button', part: 'hero.home.cta' } },
    ops: [
      {
        op: 'override',
        target: 'part:hero.home.cta',
        key: 'button.base.background',
        value: '#635bff',
      },
      { op: 'override', target: 'part:hero.home.cta', key: 'button.base.radius', value: '999' },
    ],
    check: (d, before) =>
      !!findOverride(d, 'part:hero.home.cta:button')?.style &&
      JSON.stringify(d.brand) === JSON.stringify(before.brand) &&
      !d.style?.button,
    touches: ['overrides'],
  },
  {
    name: 'hero main action: the help search',
    request: 'Put a search box in the hero instead',
    fixture: (d) => {
      d.pages.home.composer = 'band'
    },
    ops: [{ op: 'set', target: 'hero', key: 'mainAction', value: 'search' }],
    check: (d) => mainActionOf(d.pages.home) === 'search',
    touches: ['pages.home.mainAction', 'pages.home.composer'],
  },
  {
    name: 'hero main action: a button to the roadmap',
    request: 'Swap the post box up top for one button that takes people to the roadmap',
    fixture: (d) => {
      d.pages.home.composer = 'band'
    },
    ops: [
      { op: 'set', target: 'hero', key: 'mainAction', value: 'button' },
      { op: 'set', target: 'hero', key: 'buttonTo', value: 'roadmap' },
    ],
    check: (d) => mainActionOf(d.pages.home) === 'button' && buttonToOf(d.pages.home) === 'roadmap',
    touches: ['pages.home.mainAction', 'pages.home.composer', 'pages.home.button'],
  },
  {
    name: 'composer in the hero narrower',
    request: 'Make the composer narrower',
    fixture: (d) => {
      d.pages.home.composer = 'band'
    },
    ops: [{ op: 'set', target: 'hero', key: 'composerWidth', value: 'wide' }],
    check: (d, before) =>
      d.pages.home.composer === 'band' &&
      rank(DESIGN_OPTIONS.composerWidth, composerWidthOf(d)) <
        rank(DESIGN_OPTIONS.composerWidth, composerWidthOf(before)),
    touches: ['pages.home.composerWidth'],
  },
  {
    name: 'top posts from two boards, newest',
    request: 'In top posts, only show stuff from Web app and API, newest first',
    ops: [
      { op: 'set', target: 'ideas00001', key: 'boardIds', value: '["Web app","API"]' },
      { op: 'set', target: 'ideas00001', key: 'sort', value: 'new' },
    ],
    check: (d) => {
      const b = one(d, 'ideas') as Extract<Block, { type: 'ideas' }>
      return (
        b.sort === 'new' &&
        [...(b.boardIds ?? [])].sort().join() ===
          [PLACES.boards[1]!.id, PLACES.boards[2]!.id].sort().join()
      )
    },
    touches: HOME,
  },
  {
    name: 'updates before top posts',
    request: 'I want the changelog updates to come before the top posts',
    ops: [{ op: 'move', target: 'updates001', value: 'above:ideas00001' }],
    check: (d) => {
      const order = blocks(d).map((b) => b.type)
      return order.indexOf('updates') < order.indexOf('ideas')
    },
    touches: HOME,
  },
  {
    name: 'drop status, composer full width',
    request: 'Get rid of the status block and let the post box take the whole row',
    ops: [
      { op: 'remove', target: 'status0001' },
      { op: 'resize', target: 'composer01', value: 'full' },
    ],
    check: (d) => ofType(d, 'status').length === 0 && one(d, 'composer')?.grid.w === 12,
    touches: HOME,
  },
  {
    name: 'four updates',
    request: 'Show 4 changelog entries on the home page',
    ops: [{ op: 'set', target: 'updates001', key: 'count', value: '4' }],
    check: (d) => (one(d, 'updates') as { count: number }).count === 4,
    touches: HOME,
  },
  {
    name: 'no popular articles',
    request: 'Turn off popular articles in the help center',
    ops: [{ op: 'set', target: 'help page', key: 'popular', value: 'false' }],
    check: (d) => d.pages.help?.popular === false,
    touches: ['pages.help'],
  },
  {
    name: 'bolder headings',
    request: 'Make the headings heavier',
    ops: [{ op: 'theme', key: 'headingWeight', value: '700' }],
    check: (d) => d.brand.fonts.headingWeight > 600 || (d.tune?.heading?.weight ?? 0) > 600,
    touches: ['brand.fonts.headingWeight', 'tune.heading', 'tune.headline'],
  },
  {
    name: 'pill menu',
    request: 'Mark the current page in the menu with a filled pill',
    ops: [{ op: 'theme', key: 'menuStyle', value: 'pills' }],
    check: (d) => d.layout.nav === 'pills',
    touches: ['layout.nav'],
  },
  {
    name: 'hero centred with dots',
    request: 'Centre the words in the hero and add a dotted pattern',
    ops: [
      { op: 'set', target: 'hero', key: 'align', value: 'centre' },
      { op: 'set', target: 'hero', key: 'art', value: 'dots' },
    ],
    check: (d) => heroOf(d).align === 'centre' && heroOf(d).art === 'dots',
    touches: HERO,
  },
  {
    name: 'help center last in the menu',
    request: 'Move Help Center to the end of the menu',
    ops: [{ op: 'menu', target: 'help', key: 'last' }],
    check: (d) => {
      const order = menuParts(d, GATES)
        .filter((p) => p.kind !== 'home')
        .map((p) => p.id)
      return order.at(-1) === 'help' && order.length === 6
    },
    touches: ['nav.items'],
  },
  {
    name: 'brand glow at the top',
    request: 'Add a soft glow of our brand colour at the top of the page',
    ops: [
      {
        op: 'background',
        target: 'site',
        key: 'gradient',
        value: '{"stops":["accent","page"],"shape":"radial","centre":"top"}',
      },
    ],
    check: (d) => {
      const bg = d.layout.background
      return (
        bg?.kind === 'gradient' &&
        bg.shape === 'radial' &&
        (bg.centre ?? 'top') === 'top' &&
        (bg.stops[0] === 'accent' || blueish(bg.stops[0]!))
      )
    },
    touches: BACKGROUND,
  },
  {
    name: 'a tint on the changelog only',
    request: 'On the changelog only, put a pale tint of our brand colour behind the page',
    ops: [{ op: 'background', target: 'changelog', key: 'tint', value: '{"colour":"accent"}' }],
    check: (d) => {
      const own = d.layout.pageBackgrounds?.changelog
      return (
        own?.kind === 'tint' &&
        (own.colour === 'accent' || blueish(own.colour)) &&
        !d.layout.background
      )
    },
    touches: OWN_BACKGROUND,
  },
]

/* Marks: a headline's phrase set apart, and the Welcome words' bold, italic and links. */

const MARKED_TITLE = 'Help shape what Acme grows into'
const WELCOME_WORDS = 'Hello from the Acme team. Tell us what to build next.'

/** Home's headline with a phrase in it to set apart, and Welcome words of two sentences. */
const wordsToMark = (d: PortalDesign) => {
  d.pages.home.headline = { title: { en: MARKED_TITLE }, subtitle: {} }
  const welcome = d.pages.home.blocks.find((b) => b.type === 'welcome') as { body: unknown }
  welcome.body = doc(WELCOME_WORDS)
}

interface Run {
  text: string
  marks: string[]
  href?: string
}

/** The Welcome block's words as runs, each with its marks. */
function welcomeRuns(d: PortalDesign): Run[] {
  const runs: Run[] = []
  const walk = (node: {
    type?: string
    text?: string
    marks?: Array<{ type: string; attrs?: { href?: string } }>
    content?: unknown[]
  }) => {
    if (node.type === 'text')
      runs.push({
        text: node.text ?? '',
        marks: (node.marks ?? []).map((m) => m.type),
        href: node.marks?.find((m) => m.type === 'link')?.attrs?.href,
      })
    else {
      // A space between blocks, so a paragraph's words do not run into the next one's.
      if (node.type === 'paragraph' || node.type === 'listItem') runs.push({ text: ' ', marks: [] })
      ;(node.content ?? []).forEach((child) => walk(child as typeof node))
    }
  }
  walk((one(d, 'welcome') as { body: Parameters<typeof walk>[0] }).body)
  return runs
}
const allWords = (runs: Run[]) =>
  runs
    .map((r) => r.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

const accentOf = (d: PortalDesign) => {
  const accent = d.pages.home.headline?.accent
  const text = accent?.text.en
  return text ? { text, style: accent.style } : null
}
const titleKept = (d: PortalDesign) => d.pages.home.headline?.title.en === MARKED_TITLE

/** Requests about marks: what a person sets apart in a headline, and bold, italic and links in rich words. */
export const MARK_CASES: EvalCase[] = [
  {
    name: 'accent a word in the headline',
    request: 'Make "grows" the accent in the headline',
    fixture: wordsToMark,
    ops: [
      {
        op: 'words',
        target: 'home',
        key: 'title',
        value: 'Help shape what Acme [grows]{accent} into',
      },
    ],
    check: (d) => titleKept(d) && accentOf(d)?.text === 'grows' && accentOf(d)?.style === 'colour',
    touches: ['pages.home.headline'],
  },
  {
    name: 'highlight a word in the headline',
    request: 'Highlight Acme in the headline',
    fixture: wordsToMark,
    ops: [
      {
        op: 'words',
        target: 'home',
        key: 'title',
        value: 'Help shape what [Acme]{highlight} grows into',
      },
    ],
    check: (d) =>
      titleKept(d) && accentOf(d)?.text === 'Acme' && accentOf(d)?.style === 'highlight',
    touches: ['pages.home.headline'],
  },
  {
    name: 'second half of the headline lighter',
    request: 'Make the second half of the headline lighter',
    fixture: wordsToMark,
    ops: [
      {
        op: 'words',
        target: 'home',
        key: 'title',
        value: 'Help shape what [Acme grows into]{lighter}',
      },
    ],
    check: (d) => {
      const accent = accentOf(d)
      const count = accent?.text.split(' ').length ?? 0
      return (
        titleKept(d) &&
        accent?.style === 'muted' &&
        MARKED_TITLE.endsWith(` ${accent.text}`) &&
        count >= 2 &&
        count <= 4
      )
    },
    touches: ['pages.home.headline'],
  },
  {
    name: 'remove the headline accent',
    request: 'Remove the accent from the headline',
    fixture: (d) => {
      wordsToMark(d)
      d.pages.home.headline!.accent = { style: 'colour', text: { en: 'Acme' } }
    },
    ops: [{ op: 'words', target: 'home', key: 'title', value: MARKED_TITLE }],
    check: (d) => titleKept(d) && accentOf(d) === null,
    touches: ['pages.home.headline'],
  },
  {
    name: 'link to the docs in the welcome',
    request: 'Add a link to our docs at https://docs.acme.com in the welcome text',
    fixture: wordsToMark,
    ops: [
      {
        op: 'set',
        target: 'welcome001',
        key: 'body',
        value: `${WELCOME_WORDS} Read [our docs](https://docs.acme.com).`,
      },
    ],
    check: (d) => {
      const runs = welcomeRuns(d)
      return (
        allWords(runs).startsWith(WELCOME_WORDS) &&
        runs.some((r) => r.href === 'https://docs.acme.com' && r.text.trim().length > 0) &&
        runs.every((r) => !r.href || r.href === 'https://docs.acme.com')
      )
    },
    touches: HOME,
  },
  {
    name: 'bold the first sentence of the welcome',
    request: 'Bold the first sentence of the welcome',
    fixture: wordsToMark,
    ops: [
      {
        op: 'set',
        target: 'welcome001',
        key: 'body',
        value: '**Hello from the Acme team.** Tell us what to build next.',
      },
    ],
    check: (d) => {
      const runs = welcomeRuns(d)
      const bold = allWords(runs.filter((r) => r.marks.includes('bold')))
      return (
        allWords(runs) === WELCOME_WORDS &&
        bold.replace(/\.$/, '') === 'Hello from the Acme team' &&
        runs.every((r) => r.marks.every((m) => m === 'bold'))
      )
    },
    touches: HOME,
  },
  {
    name: 'italic words in the welcome',
    request: 'Put "what to build next" in italics in the welcome text',
    fixture: wordsToMark,
    ops: [
      {
        op: 'set',
        target: 'welcome001',
        key: 'body',
        value: 'Hello from the Acme team. Tell us *what to build next*.',
      },
    ],
    check: (d) => {
      const runs = welcomeRuns(d)
      return (
        allWords(runs) === WELCOME_WORDS &&
        allWords(runs.filter((r) => r.marks.includes('italic'))) === 'what to build next' &&
        runs.every((r) => r.marks.every((m) => m === 'italic'))
      )
    },
    touches: HOME,
  },
]

/** JSON with object keys in order, so two documents differing only in key order read alike. */
const stable = (value: unknown): string =>
  JSON.stringify(value ?? null, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  )

/** Every field that differs between two designs, lists and translated words compared whole. */
export function changedPaths(a: unknown, b: unknown, at = ''): string[] {
  if (stable(a) === stable(b)) return []
  const isObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!isObject(a) || !isObject(b)) return [at]
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
  return [...keys].flatMap((key) =>
    changedPaths(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      at ? `${at}.${key}` : key
    )
  )
}

/** Whether a design answers a case: its rule holds and nothing outside what it touches changed. */
export function judge(
  c: EvalCase,
  before: PortalDesign,
  after: PortalDesign
): { right: boolean; stray: string[] } {
  const stray = changedPaths(before, after).filter(
    (path) =>
      !c.touches.some(
        (field) => path === field || path.startsWith(`${field}.`) || field.startsWith(`${path}.`)
      )
  )
  return { right: c.check(after, before) && stray.length === 0, stray }
}

/** The value at a path, read through objects and lists. */
const at = (d: unknown, path: string) =>
  path
    .split('.')
    .reduce<unknown>(
      (v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
      d
    )

const blockIndex = (d: PortalDesign, id: string) =>
  d.pages.home.blocks.findIndex((b) => b.id === id)
const blockLook = (d: PortalDesign, id: string, path: string) =>
  at(d.pages.home.blocks[blockIndex(d, id)], `look.style.${path}`)

/**
 * Answers as right as the registry's own, through another field that draws
 * the same: an exact value, or the same look set on every Home block.
 */
function equivalent(element: string): ((d: PortalDesign) => boolean) | undefined {
  switch (element) {
    case 'link':
      return (d) => d.tune?.link?.underline === 'hover'
    case 'subtitle':
      return (d) => d.tune?.subtitle?.weight === 300
    case 'block':
      return (d) =>
        d.pages.home.blocks.length > 0 &&
        d.pages.home.blocks.every((b) => b.look?.style?.block?.base?.borderStyle === 'dashed')
    default:
      return undefined
  }
}
function equivalentTouches(element: string): string[] {
  return (
    (
      { link: ['tune.link'], subtitle: ['tune.subtitle'], block: ['pages.home.blocks'] } as Record<
        string,
        string[]
      >
    )[element] ?? []
  )
}

/**
 * Element styles: one case per element, written from the registry's own
 * example (so a new element brings its case), then states, dark mode and a
 * Home block's own look, written by hand.
 */
function styleCases(): EvalCase[] {
  const generated: EvalCase[] = STYLE_ELEMENT_NAMES.map((element) => {
    const { request, state, prop, value } = STYLE_ELEMENTS[element].example
    const path = `style.${element}.${state}.${prop}`
    const want = readStyleValue(prop as StyleProp, typeof value === 'number' ? value : value)
    return {
      name: `style: ${element} ${state} ${prop}`,
      request,
      ops: [{ op: 'theme', key: path, value: String(value) }],
      check: (d) => {
        const got = at(d, path)
        // A gradient is right with its two colours, whatever its angle.
        const same =
          want && typeof want === 'object'
            ? JSON.stringify([(got as { from?: unknown })?.from, (got as { to?: unknown })?.to]) ===
              JSON.stringify([(want as { from: unknown }).from, (want as { to: unknown }).to])
            : JSON.stringify(got) === JSON.stringify(want) ||
              // The brand colour as text is the brand colour, made to read.
              (want === 'accent' && got === 'accent-text')
        return same || (equivalent(element)?.(d) ?? false)
      },
      touches: ['style', ...equivalentTouches(element)],
    }
  })
  const byHand: EvalCase[] = [
    {
      name: 'style: menu items in the brand colour on hover',
      request: 'Menu items should turn the brand colour when you point at them',
      ops: [{ op: 'theme', key: 'style.navItem.hover.color', value: 'accent' }],
      check: (d) =>
        ['accent', 'accent-text', '#4f46e5'].includes(String(at(d, 'style.navItem.hover.color'))),
      touches: ['style'],
    },
    {
      name: 'style: disabled buttons faded',
      request: 'Disabled buttons should look half see-through',
      ops: [{ op: 'theme', key: 'style.button.disabled.opacity', value: '0.5' }],
      check: (d) => {
        const o = at(d, 'style.button.disabled.opacity')
        return typeof o === 'number' && o >= 0.3 && o <= 0.6
      },
      touches: ['style'],
    },
    {
      name: 'style: a thick focus ring on buttons, still neutral',
      request: 'When buttons are focused with the keyboard, show a thicker 3px ring',
      ops: [{ op: 'theme', key: 'style.button.focus.ringWidth', value: '3' }],
      check: (d) => at(d, 'style.button.focus.ringWidth') === 3,
      touches: ['style'],
    },
    {
      name: 'style: dark mode links',
      request: 'In dark mode only, make links light blue, #93c5fd',
      ops: [{ op: 'theme', key: 'styleDark.link.base.color', value: '#93c5fd' }],
      check: (d) => at(d, 'styleDark.link.base.color') === '#93c5fd',
      touches: ['styleDark'],
    },
    {
      name: 'block style: top posts on pale yellow',
      request: 'Give the Top posts block a pale yellow background, #fef9c3',
      ops: [
        { op: 'set', target: 'ideas00001', key: 'style.block.base.background', value: '#fef9c3' },
      ],
      check: (d) => blockLook(d, 'ideas00001', 'block.base.background') === '#fef9c3',
      touches: ['pages.home.blocks'],
    },
    {
      name: 'block style: picked block heading in the brand colour',
      request: 'Make this block’s heading the brand colour',
      picked: { scope: 'home', blockId: 'updates001' },
      ops: [{ op: 'set', target: 'updates001', key: 'style.heading.base.color', value: 'accent' }],
      check: (d) =>
        ['accent', 'accent-text'].includes(
          String(blockLook(d, 'updates001', 'heading.base.color'))
        ),
      touches: ['pages.home.blocks'],
    },
    {
      name: 'block style: cards in top posts rise on hover',
      request: 'In Top posts only, cards should rise a few pixels on hover',
      ops: [{ op: 'set', target: 'ideas00001', key: 'style.postCard.hover.lift', value: '3' }],
      check: (d) => {
        const lift = blockLook(d, 'ideas00001', 'postCard.hover.lift')
        return typeof lift === 'number' && lift > 0
      },
      touches: ['pages.home.blocks'],
    },
  ]
  return [...generated, ...byHand]
}
