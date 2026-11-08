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
  [/^pages\.help\.(helpful|related|contact)\b/, 'help', 'article'],
  [/^pages\.support\b/, 'support', 'request'],
  [/^pages\.feedback\.welcome\b/, 'feedback', 'welcome'],
  [/^(pages\.feedback\.(copy|defaultSort)|layout\.postCardHides)\b/, 'feedback', 'feed'],
  [/^layout\.filters\b/, 'feedback', 'filters'],
  [/^pages\.feedback\.headline\b/, 'feedback', 'hero'],
  [/^pages\.home\.headline\b/, 'home', 'hero'],
]

const HEADER = /^(layout\.(header|nav|navText|menuAlign|headerOnBand)|nav|brand\.logo)\b/

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
  const tuned = /^tune\.(\w+)\./.exec(path)
  if (tuned)
    return TUNE_ELEMENTS[tuned[1]!] ? { page: null, element: TUNE_ELEMENTS[tuned[1]!] } : null
  for (const [field, page, section] of SECTION_FIELDS)
    if (field.test(path)) return { page, section }
  const titled = /^pages\.titles\.(roadmap|changelog|help|support)\b/.exec(path)
  if (titled) return { page: titled[1] as DesignerPage, section: 'hero' }
  if (HERO_AI_PATHS.some((field) => path === field || path.startsWith(`${field}.`)))
    return { page: path.startsWith('pages.home.') ? 'home' : null, section: 'hero' }
  if (path === 'brand.bandImage' || path.startsWith('brand.bandImage.'))
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
  return spotsOfChanges(
    after,
    patches.map((patch) => ({
      path: patch.path.join('.'),
      before: undefined,
      after: patch.op === 'remove' ? undefined : patch.value,
    }))
  )
}
