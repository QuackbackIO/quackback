/**
 * The builder's product events, every one listed here with what it carries.
 * A property is a choice from a fixed list, a setting id from the design
 * schema, a count, a duration or a flag: never words, links or colours a
 * person typed. An event whose properties break that is not sent. Each goes
 * through `track()`, so where analytics is not configured nothing is sent.
 */
import { track, trackOnceStarted } from '@/lib/client/analytics'
import { designChanges } from '@/lib/shared/design/diff'
import type { HomeBlockType } from '@/lib/shared/design/home'
import {
  BLOCK_NAMES,
  PAGE_NAMES,
  type DesignerPage,
  SITE_PARTS,
  type Selection,
  type SitePart,
} from '@/lib/shared/design/outline'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { isSettingId, settingIdOf } from '@/lib/shared/design/setting-ids'

const SECTIONS = [
  'site',
  'header',
  'hero',
  'welcome',
  'feed',
  'filters',
  'home',
  'entries',
  'topics',
  'popular',
  'board',
] as const satisfies readonly Selection[]

export type PartId =
  | (typeof SECTIONS)[number]
  | `site:${SitePart}`
  | `block:${HomeBlockType}`
  | `page:${DesignerPage}`
  | 'link'

/**
 * Every part a pick can name: a section, a site style, a Home block by its
 * type, a page of the menu, or a link of it.
 */
export const PART_IDS: readonly PartId[] = [
  ...SECTIONS,
  ...(Object.keys(SITE_PARTS) as SitePart[]).map((part) => `site:${part}` as const),
  ...(Object.keys(BLOCK_NAMES) as HomeBlockType[]).map((type) => `block:${type}` as const),
  ...(Object.keys(PAGE_NAMES) as DesignerPage[]).map((page) => `page:${page}` as const),
  'link',
]

const PAGES = Object.keys(PAGE_NAMES) as Array<keyof typeof PAGE_NAMES>
export const ENTRIES = ['portal', 'appearance', 'direct'] as const
export const PANELS = [
  'overview',
  'settings',
  'ai',
  'help',
  'quick_find',
  /** The page switcher. */
  'pages',
  /** A menu item's own menu, opened on the page. */
  'menu_item',
  /** "+" at the end of the menu. */
  'menu_add',
  'add',
  'theme',
  'theme_more',
] as const
export const DEVICES = ['desktop', 'tablet', 'phone'] as const
/** What someone did to the portal's menu, on the page or in the header's panel. */
export const MENU_CHANGES = [
  'go',
  'rename',
  'land',
  'hide',
  'show',
  'move',
  'remove',
  'edit_link',
  'add_link',
  'sign_in_settings',
] as const
export const MENU_FROM = ['canvas', 'panel'] as const
export const LOOK_SOURCES = ['ai', 'saved', 'preset'] as const

/** A setting's id; only `settingId` makes one, so a raw string cannot be sent as one. */
export type SettingId = string & { readonly __settingId: true }
export function settingId(path: string): SettingId | null {
  return settingIdOf(path) as SettingId | null
}

type Kind = readonly string[] | 'count' | 'seconds' | 'ratio' | 'flag' | 'setting'
type Spec = Record<string, Kind | { optional: Kind }>
const optional = <K extends Kind>(kind: K) => ({ optional: kind })

export const BUILDER_EVENTS = {
  designer_opened: { entry: ENTRIES },
  designer_closed: { seconds: 'seconds', published: 'flag' },
  /** A panel, a sheet over the right panel, or the AI dock opened. */
  designer_panel_opened: { panel: PANELS },
  designer_device_switched: { device: DEVICES },
  designer_draft_discarded: { changes: 'count' },
  designer_part_picked: { part: PART_IDS },
  designer_setting_changed: { setting: 'setting' },
  /** An Advanced disclosure opened, such as Styles' exact sizes, band options and CSS. */
  designer_advanced_opened: { part: PART_IDS },
  designer_custom_css_edited: { page: PAGES },
  designer_exact_value_changed: { setting: 'setting' },
  /** A page shown; `via` preview when Preview followed a visitor there. */
  designer_page_switched: { page: PAGES, via: optional(['preview'] as const) },
  /** A change to the menu, or Go to, from a menu item on the page or the header's panel. */
  designer_menu_changed: { change: MENU_CHANGES, from: MENU_FROM },
  /** A one-time coach mark dismissed. */
  designer_coach_dismissed: { coach: ['menu'] },
  designer_preview_link_shared: {},
  designer_versions_opened: {},
  designer_version_restored: { how: ['restore', 'copy'] },
  designer_look_applied: { source: LOOK_SOURCES, fields: 'count' },
  /** A screenshot in Ask AI warned of a pop-up's dimming or a cookie banner, sent anyway. */
  designer_chat_shot_kept: { warning: ['dimmed', 'banner'] },
  /** A brand matched from screenshots sent in Ask AI: how many, and the settings it changed. */
  designer_brand_matched: { images: 'count', changes: 'count' },
  /** The check after a brand match: revision rounds tried, changes kept, and why it stopped. */
  designer_brand_checked: {
    rounds: 'count',
    kept: 'count',
    stopped: ['bar', 'rounds', 'no_gain', 'no_revision', 'time', 'failed'],
  },
  /** The logo a brand match placed, changed from its card: the crop adjusted, or shown another way. */
  designer_brand_logo_changed: { how: ['adjusted', 'full_logo', 'icon'] },
  designer_published: {
    changes: 'count',
    fullReview: 'flag',
    logoOffered: 'flag',
    workspaceLogo: 'flag',
    firstPublish: 'flag',
    seconds: 'seconds',
    secondsSinceFirstOpen: optional('seconds'),
    /** The fields the last applied look set, and the share of them still as it set them. */
    lookFields: optional('count'),
    lookKept: optional('ratio'),
  },
} as const satisfies Record<string, Spec>

export type BuilderEvent = keyof typeof BUILDER_EVENTS

type ValueOf<K> = K extends readonly string[]
  ? K[number]
  : K extends 'flag'
    ? boolean
    : K extends 'setting'
      ? SettingId
      : number
type Props<S> = {
  [P in keyof S as S[P] extends { optional: Kind } ? never : P]: ValueOf<S[P]>
} & {
  [P in keyof S as S[P] extends { optional: Kind } ? P : never]?: S[P] extends {
    optional: infer K
  }
    ? ValueOf<K>
    : never
}
export type BuilderEventProps<E extends BuilderEvent> = Props<(typeof BUILDER_EVENTS)[E]>

/** Whether one value is what its kind allows, and nothing else. */
export function fitsKind(kind: Kind, value: unknown): boolean {
  if (Array.isArray(kind)) return typeof value === 'string' && kind.includes(value)
  switch (kind) {
    case 'flag':
      return typeof value === 'boolean'
    case 'setting':
      return typeof value === 'string' && isSettingId(value)
    case 'ratio':
      return typeof value === 'number' && value >= 0 && value <= 1
    default:
      return typeof value === 'number' && Number.isInteger(value) && value >= 0
  }
}

/** Whether an event's properties are exactly those listed for it, each of its kind. */
export function fitsEvent(event: string, props: Record<string, unknown>): boolean {
  const spec = (BUILDER_EVENTS as Record<string, Spec>)[event]
  if (!spec) return false
  for (const key of Object.keys(props))
    if (!Object.hasOwn(spec, key) && props[key] !== undefined) return false
  return Object.entries(spec).every(([key, entry]) => {
    const isOptional = typeof entry === 'object' && !Array.isArray(entry)
    const kind = isOptional ? (entry as { optional: Kind }).optional : (entry as Kind)
    if (props[key] === undefined) return isOptional
    return fitsKind(kind, props[key])
  })
}

export function trackBuilder<E extends BuilderEvent>(
  event: E,
  props: BuilderEventProps<E>,
  send: (event: string, props: Record<string, unknown>) => void = (name, sent) =>
    void track(name, sent)
): void {
  const sent = Object.fromEntries(
    Object.entries(props as Record<string, unknown>).filter(([, value]) => value !== undefined)
  )
  if (!fitsEvent(event, sent)) return
  send(event, sent)
}

// What the builder remembers about this visit, to say how it ended.
const visit = { openedAt: 0, published: false, closed: true }
const seconds = (since: number) => Math.max(0, Math.round((Date.now() - since) / 1000))
const FIRST_OPEN_KEY = 'quackback:designer-first-open'
const LOOK_KEY = 'quackback:designer-look'

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage closed: the measure that needs it is left out.
  }
}

export function designerOpened(entry: (typeof ENTRIES)[number]): void {
  visit.openedAt = Date.now()
  visit.published = false
  visit.closed = false
  if (!stored(FIRST_OPEN_KEY)) store(FIRST_OPEN_KEY, String(visit.openedAt))
  // Sent as the page opens, so it waits for the SDK to start.
  trackBuilder('designer_opened', { entry }, trackOnceStarted)
}

/** Once a visit, however it ends. */
export function designerClosed(): void {
  if (visit.closed) return
  visit.closed = true
  trackBuilder('designer_closed', { seconds: seconds(visit.openedAt), published: visit.published })
}

/** The part a selection names, with a Home block named by its type, never its id. */
export function partIdOf(selection: Selection, design: PortalDesign): PartId | null {
  if (selection.startsWith('block-')) {
    const id = selection.slice('block-'.length)
    const blocks = design.pages.home.blocks
    const block = blocks.find((each, index) => (each.id ?? String(index)) === id)
    return block ? `block:${block.type}` : null
  }
  if (selection.startsWith('link:')) return 'link'
  return (PART_IDS as readonly string[]).includes(selection) ? (selection as PartId) : null
}

/** An Advanced disclosure opened, named by the part it is under. */
export function designerAdvancedOpened(part: PartId): void {
  trackBuilder('designer_advanced_opened', { part })
}

export function designerPartPicked(selection: Selection, design: PortalDesign): void {
  const part = partIdOf(selection, design)
  if (part) trackBuilder('designer_part_picked', { part })
}

/** A burst of the same change, such as typing, counts once. */
const BURST_MS = 1000
let lastSetting: { id: string; at: number } | null = null
// A look chosen, so the change that applies it counts as the look, not as each setting.
let lookChosen: (typeof LOOK_SOURCES)[number] | null = null

export function designerLookChosen(source: (typeof LOOK_SOURCES)[number]): void {
  lookChosen = source
}

/** Counts a change made in the builder, by the settings it changed. */
export function designerChanged(
  before: PortalDesign,
  after: PortalDesign,
  page: (typeof PAGES)[number]
): void {
  const changes = designChanges(before, after)
  if (lookChosen) {
    const source = lookChosen
    lookChosen = null
    const fields = Object.fromEntries(changes.map((each) => [each.path, json(each.after)]))
    store(LOOK_KEY, changes.length ? JSON.stringify(fields) : null)
    trackBuilder('designer_look_applied', { source, fields: changes.length })
    return
  }
  const now = Date.now()
  const ids = [...new Set(changes.map((each) => settingId(each.path)).filter((id) => id !== null))]
  for (const id of ids) {
    const burst = lastSetting?.id === id && now - lastSetting.at < BURST_MS
    lastSetting = { id, at: now }
    if (burst) continue
    trackBuilder('designer_setting_changed', { setting: id })
    if (id === 'tune' || id.startsWith('tune.'))
      trackBuilder('designer_exact_value_changed', { setting: id })
    if (id === 'css') trackBuilder('designer_custom_css_edited', { page })
  }
}

const json = (value: unknown) => JSON.stringify(value ?? null)

function valueAt(design: unknown, path: string): unknown {
  let node = design
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

/** The share of the last applied look's fields a design still holds as the look set them. */
function lookKept(design: PortalDesign): { lookFields: number; lookKept: number } | null {
  const raw = stored(LOOK_KEY)
  if (!raw) return null
  try {
    const fields = Object.entries(JSON.parse(raw) as Record<string, string>)
    if (!fields.length) return null
    const kept = fields.filter(([path, value]) => json(valueAt(design, path)) === value).length
    return { lookFields: fields.length, lookKept: Math.round((kept / fields.length) * 100) / 100 }
  } catch {
    return null
  }
}

export function designerPublished(
  draft: { changes: readonly unknown[]; published: unknown; design: PortalDesign },
  /** fullReview: published from the full review, not the short summary. */
  options: { logoOffered: boolean; workspaceLogo: boolean; fullReview: boolean }
): void {
  const firstOpen = Number(stored(FIRST_OPEN_KEY))
  const firstPublish = !draft.published
  const look = lookKept(draft.design)
  visit.published = true
  trackBuilder('designer_published', {
    changes: draft.changes.length,
    fullReview: options.fullReview,
    logoOffered: options.logoOffered,
    workspaceLogo: options.workspaceLogo,
    firstPublish,
    seconds: seconds(visit.openedAt),
    ...(firstPublish && firstOpen > 0 ? { secondsSinceFirstOpen: seconds(firstOpen) } : {}),
    ...(look ?? {}),
  })
  // A look counts towards the publish it reached, once.
  store(LOOK_KEY, null)
}
