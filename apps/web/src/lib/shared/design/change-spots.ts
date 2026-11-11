/**
 * Where a change shows on the canvas: the page it is on, the part of the
 * page (a `data-qb-section` key, as the outline names parts), and for an
 * element's style, the element and the state it is in. The builder outlines
 * these after an AI step and from Show changes' Show. A change the whole
 * portal takes at once, such as the brand colour or the corners, has no one
 * spot to point at, and no spot.
 */
import { HERO_AI_PATHS } from './hero'
import { patchesBetween } from './history'
import { PAGE_NAMES } from './names'
import type { DesignerPage } from './paths'
import type { PortalDesign } from './schema'
import { STATE_INFO, STYLE_ELEMENTS, type StyleElement, type StyleState } from './style-tokens'
import type { StyleOverride } from './style-overrides'

export interface ChangeSpot {
  /** The page it is on; null where every page that draws the part shows it. */
  page: DesignerPage | null
  /** The part of the page, as `data-qb-section` marks it. */
  section?: string
  /** The element a style changed, drawn wherever it is. */
  element?: StyleElement
  /** The state a style changed, which the canvas forces to show it. */
  state?: StyleState
}

/** A change as a request reports it. */
export interface SpotChange {
  path: string
  before: unknown
  after: unknown
}

/** The pages with a hero: every page but a post and the status page. */
const HERO_PAGES: readonly DesignerPage[] = [
  'home',
  'feedback',
  'roadmap',
  'changelog',
  'help',
  'support',
]

/** The exact values each part keeps, as the element they style. */
const TUNE_ELEMENTS: Record<string, StyleElement> = {
  headline: 'headline',
  heading: 'heading',
  button: 'button',
  card: 'postCard',
  field: 'input',
  subtitle: 'subtitle',
  link: 'link',
  secondary: 'secondary',
  body: 'body',
}

/** Fields of a page's own sections, and the section each is drawn in. */
const SECTION_FIELDS: Array<[RegExp, DesignerPage, string]> = [
  [/^pages\.roadmap\b/, 'roadmap', 'board'],
  [/^pages\.changelog\b/, 'changelog', 'entries'],
  [/^pages\.help\.topics\b/, 'help', 'topics'],
  [/^pages\.help\.popular\b/, 'help', 'popular'],
  [/^pages\.help\.search\b/, 'help', 'hero'],
  [/^pages\.post\.vote\b/, 'post', 'vote'],
  [/^pages\.post\.comments\b/, 'post', 'comments'],
  [/^pages\.post\b/, 'post', 'details'],
  [/^pages\.help\.(helpful|related|contact)\b/, 'help', 'article'],
  [/^pages\.support\b/, 'support', 'request'],
  [/^pages\.feedback\.welcome\b/, 'feedback', 'welcome'],
  [/^(pages\.feedback\.(copy|defaultSort|openOn)|layout\.postCardHides)\b/, 'feedback', 'feed'],
  [/^layout\.filters\b/, 'feedback', 'filters'],
  [/^pages\.feedback\.headline\b/, 'feedback', 'hero'],
  [/^pages\.home\.headline\b/, 'home', 'hero'],
]

const HEADER = /^(layout\.(header|nav|navText|menuAlign|headerOnHero)|nav|brand\.logo)\b/

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** The fields inside a change whose values differ, as dotted paths. */
function leaves(path: string, before: unknown, after: unknown, depth = 0): SpotChange[] {
  if (depth < 4 && (isPlain(before) || isPlain(after))) {
    const keys = new Set([
      ...Object.keys(isPlain(before) ? before : {}),
      ...Object.keys(isPlain(after) ? after : {}),
    ])
    return [...keys].flatMap((key) =>
      leaves(
        `${path}.${key}`,
        isPlain(before) ? before[key] : undefined,
        isPlain(after) ? after[key] : undefined,
        depth + 1
      )
    )
  }
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null)
    ? []
    : [{ path, before, after }]
}

/** Home's blocks a change to their list made or changed, by id; one removed has no spot. */
function blocksChanged(design: PortalDesign, change: SpotChange): ChangeSpot[] {
  const at = /^pages\.home\.blocks\.(\d+)\b/.exec(change.path)
  if (at) {
    const id = design.pages.home.blocks[Number(at[1])]?.id
    return id ? [{ page: 'home', section: `block-${id}` }] : []
  }
  const list = (value: unknown) => (Array.isArray(value) ? (value as Array<{ id?: string }>) : [])
  const was = new Map(list(change.before).map((block) => [block.id, JSON.stringify(block)]))
  return list(change.after)
    .filter((block) => block.id && was.get(block.id) !== JSON.stringify(block))
    .map((block) => ({ page: 'home', section: `block-${block.id}` }))
}

/** Where a part is drawn, from its name in the parts registry; null for one not known. */
function partSpot(part: string): ChangeSpot | null {
  const [head, second] = part.split('.')
  if (head === 'header' || head === 'nav') return { page: null, section: 'header' }
  if ((head === 'hero' || head === 'title') && second && Object.hasOwn(PAGE_NAMES, second))
    return { page: second as DesignerPage, section: 'hero' }
  if (head === 'block' && second) return { page: 'home', section: `block-${second}` }
  if (part === 'feed.filters') return { page: 'feedback', section: 'filters' }
  if (head === 'feed') return { page: 'feedback', section: 'feed' }
  if (head === 'board') return { page: 'roadmap', section: 'board' }
  if (part === 'post.vote') return { page: 'post', section: 'vote' }
  if (head === 'footer') return { page: null, section: 'footer' }
  return null
}

/**
 * Where an override shows, by its id: a page's on that page, a part's in
 * the part's section, a Home block's in that block; each on its element.
 */
function overrideSpot(id: string): ChangeSpot | null {
  const m = /^(page|part|block):(.+?)(?::(\w+))?$/.exec(id)
  if (!m) return null
  const [, scope, where, kind] = m
  const element =
    kind && Object.hasOwn(STYLE_ELEMENTS, kind) ? { element: kind as StyleElement } : {}
  if (scope === 'block') return { page: 'home', section: `block-${where}`, ...element }
  if (scope === 'page')
    return Object.hasOwn(PAGE_NAMES, where!) ? { page: where as DesignerPage, ...element } : null
  return { ...(partSpot(where!) ?? { page: null }), ...element }
}

/** The state a look's changed value is in, from `<layer>.<state>.<prop>`, when not base. */
function stateOf(path: string): { state?: StyleState } {
  const state = /\.(\w+)\.\w+$/.exec(path)?.[1]
  return state && state !== 'base' && Object.hasOwn(STATE_INFO, state)
    ? { state: state as StyleState }
    : {}
}

/** The overrides two lists hold differently, each where it shows and in the state it changed. */
function overridesChanged(before: unknown, after: unknown): ChangeSpot[] {
  const byId = (value: unknown) =>
    new Map(
      (Array.isArray(value) ? (value as StyleOverride[]) : []).map((o) => [
        o.id,
        { style: o.style, styleDark: o.styleDark, phone: o.phone },
      ])
    )
  const was = byId(before)
  const now = byId(after)
  return [...new Set([...was.keys(), ...now.keys()])].flatMap((id) => {
    const spot = overrideSpot(id)
    if (!spot) return []
    const changed = leaves('', was.get(id), now.get(id))
    return changed.map((leaf) => (spot.element ? { ...spot, ...stateOf(leaf.path) } : spot))
  })
}

/** One field's spot, or null where the whole portal takes it. */
function spotOfField(path: string): ChangeSpot | null {
  const styled = /^(?:style|styleDark|stylePhone)\.(\w+)\.(\w+)\.\w+$/.exec(path)
  if (styled) {
    const [, element, state] = styled
    if (!Object.hasOwn(STYLE_ELEMENTS, element!)) return null
    return {
      page: null,
      element: element as StyleElement,
      ...(state !== 'base' && Object.hasOwn(STATE_INFO, state!)
        ? { state: state as StyleState }
        : {}),
    }
  }
  // An override's value as people and the AI write it: `overrides.<id>.<layer>.<state>.<prop>`.
  const override = /^overrides\.(.+)\.(?:style|styleDark|phone)\.\w+\.\w+$/.exec(path)
  if (override) {
    const spot = overrideSpot(override[1]!)
    return spot && (spot.element ? { ...spot, ...stateOf(path) } : spot)
  }
  const tuned = /^tune\.(\w+)\./.exec(path)
  if (tuned)
    return TUNE_ELEMENTS[tuned[1]!] ? { page: null, element: TUNE_ELEMENTS[tuned[1]!] } : null
  for (const [field, page, section] of SECTION_FIELDS)
    if (field.test(path)) return { page, section }
  const titled = /^pages\.titles\.(roadmap|changelog|help|support)\b/.exec(path)
  if (titled) return { page: titled[1] as DesignerPage, section: 'hero' }
  if (HERO_AI_PATHS.some((field) => path === field || path.startsWith(`${field}.`)))
    return { page: path.startsWith('pages.home.') ? 'home' : null, section: 'hero' }
  if (path === 'brand.heroImage' || path.startsWith('brand.heroImage.'))
    return { page: null, section: 'hero' }
  if (HEADER.test(path)) return { page: null, section: 'header' }
  const background = /^layout\.pageBackgrounds\.(\w+)\b/.exec(path)
  if (background && Object.hasOwn(PAGE_NAMES, background[1]!))
    return { page: background[1] as DesignerPage }
  return null
}

const key = (spot: ChangeSpot) =>
  [spot.page ?? '', spot.section ?? '', spot.element ?? '', spot.state ?? ''].join('|')

/** Where a change shows, each spot once; none for a change the whole portal takes. */
export function changeSpots(design: PortalDesign, change: SpotChange): ChangeSpot[] {
  const spots =
    change.path === 'pages.home.blocks' || change.path.startsWith('pages.home.blocks.')
      ? blocksChanged(design, change)
      : change.path === 'overrides'
        ? overridesChanged(change.before, change.after)
        : leaves(change.path, change.before, change.after).flatMap((leaf) => {
            const spot = spotOfField(leaf.path)
            return spot ? [spot] : []
          })
  const seen = new Set<string>()
  return spots.filter((spot) => !seen.has(key(spot)) && !!seen.add(key(spot)))
}

/**
 * The page a spot is shown on: its own, else the page shown when it draws
 * the part, else the first page that does among those given.
 */
export function pageForSpot(
  spot: ChangeSpot,
  shown: DesignerPage,
  pages: readonly DesignerPage[]
): DesignerPage | null {
  if (spot.page) return pages.includes(spot.page) ? spot.page : null
  if (spot.section !== 'hero') return shown
  if (HERO_PAGES.includes(shown)) return shown
  return pages.find((page) => HERO_PAGES.includes(page)) ?? null
}

/** Where a request's changes show, each spot once. */
export function spotsOfChanges(design: PortalDesign, changes: readonly SpotChange[]): ChangeSpot[] {
  const seen = new Set<string>()
  return changes
    .flatMap((change) => changeSpots(design, change))
    .filter((spot) => !seen.has(key(spot)) && !!seen.add(key(spot)))
}

/** Where what changed between two designs shows, such as an AI step's draft and the one before. */
export function spotsBetween(before: PortalDesign, after: PortalDesign): ChangeSpot[] {
  const [patches] = patchesBetween(before, after)
  // Overrides are a list: they are compared whole, by id, as an index names a different one after a removal.
  const overrides = patches.some((patch) => patch.path[0] === 'overrides')
    ? [{ path: 'overrides', before: before.overrides, after: after.overrides }]
    : []
  return spotsOfChanges(after, [
    ...patches
      .filter((patch) => patch.path[0] !== 'overrides')
      .map((patch) => ({
        path: patch.path.join('.'),
        before: undefined,
        after: patch.op === 'remove' ? undefined : patch.value,
      })),
    ...overrides,
  ])
}

/** Fields the widget takes from the design: its colours, light or dark, fonts, logo and corners. */
const WIDGET_FIELDS = /^(mode|brand\.(light|dark|fonts|logo)|shape)\b/

/**
 * Which pages a draft's changes show on, and whether the widget shows any,
 * read from where each change is drawn rather than by drawing every page.
 * A change the whole portal takes (the brand colour, the corners) or a part
 * every page draws (the header) shows on all of them; a hero's on each page
 * with one; anything else on its own page.
 */
export function pagesChanged(
  design: PortalDesign,
  changes: readonly SpotChange[],
  pages: readonly DesignerPage[]
): { pages: ReadonlySet<DesignerPage>; widget: boolean } {
  const widget = changes.some((change) => WIDGET_FIELDS.test(change.path))
  const everywhere = { pages: new Set(pages), widget }
  const shown = new Set<DesignerPage>()
  for (const change of changes) {
    const spots = changeSpots(design, change)
    // A page's own field with no one spot, such as a Home block taken out, is on that page.
    const own = /^pages\.(\w+)\b/.exec(change.path)?.[1] as DesignerPage | undefined
    if (spots.length === 0 && own && Object.hasOwn(PAGE_NAMES, own)) {
      shown.add(own)
      continue
    }
    if (spots.length === 0) return everywhere
    for (const spot of spots) {
      if (spot.page) shown.add(spot.page)
      else if (spot.section === 'hero') for (const page of HERO_PAGES) shown.add(page)
      else return everywhere
    }
  }
  return { pages: new Set(pages.filter((page) => shown.has(page))), widget }
}
