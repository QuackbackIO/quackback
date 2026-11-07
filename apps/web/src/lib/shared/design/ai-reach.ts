/**
 * How far an Ask AI request may reach from what was picked, and how far its
 * changes did reach. The composer's chip offers the reaches a pick has, its
 * panel's own default first ("Hero · every page (4)", "Call to action ·
 * just this one"); the one chosen goes with the request as its `within`,
 * and the server holds every change to it. The words a request uses ("only
 * on this page") are hints for the model, never the authority.
 *
 * After a request, its reply ends with a short clause when the changes land
 * beyond the page shown ("on every page"), and what else a shared field
 * changes is said under Show changes.
 *
 * Pure.
 */
import type { AiElementPick, AppliedDesignChange, DesignAiScope } from './apply-changes'
import { singular } from './element-pick'
import { alsoChanges } from './labels'
import { PAGE_NAMES } from './names'
import { designerPages } from './outline'
import { allPartsOf } from './parts-registry'
import type { DesignerPage, PortalPageGates } from './paths'
import type { PortalDesign } from './schema'
import type { OverridePage, StyleOverride } from './style-overrides'

/**
 * How far a request may reach: just the part picked, the page shown, or
 * everywhere the pick is (every page a section is on, every one of an
 * element's kind).
 */
export const AI_REACHES = ['one', 'page', 'every'] as const
export type AiReach = (typeof AI_REACHES)[number]

/** A reach the chip offers, in the words it says. */
export interface ReachChoice {
  reach: AiReach
  words: string
}

/** What was picked, as Ask AI is told it. */
export interface AiPick {
  scope: DesignAiScope
  blockId?: string
  element?: AiElementPick | null
}

const EVERY_GATE: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/** Sections that are on every page anyway, so every page is all they can reach. */
const ON_EVERY_PAGE: ReadonlySet<DesignAiScope> = new Set(['header', 'menu', 'logo'])

/**
 * The reaches a pick offers, the panel's default first: an element starts
 * shared (every one of its kind), as its panel does; the hero starts at
 * every page it is on; a Home block keeps to itself. None for the whole
 * site or its styles, which reach everything.
 */
export function reachChoices(
  design: PortalDesign,
  pick: AiPick,
  page: DesignerPage,
  gates: Partial<PortalPageGates> = EVERY_GATE
): ReachChoice[] {
  if (pick.scope === 'site' || pick.scope === 'brand') return []
  if (pick.element)
    return [
      { reach: 'every', words: `every ${singular(pick.element.element).toLowerCase()}` },
      { reach: 'page', words: 'this page' },
      ...(pick.element.part ? [{ reach: 'one' as const, words: 'just this one' }] : []),
    ]
  if (pick.blockId) return [{ reach: 'one', words: 'on Home' }]
  if (pick.scope === 'band') {
    const pages = designerPages(design, { ...EVERY_GATE, ...gates }).filter(
      (each) => each !== 'post' && each !== 'status'
    ).length
    return [
      { reach: 'every', words: `every page (${pages})` },
      { reach: 'page', words: 'this page' },
    ]
  }
  if (ON_EVERY_PAGE.has(pick.scope)) return [{ reach: 'every', words: 'every page' }]
  return [{ reach: 'every', words: `on ${PAGE_NAMES[page]}` }]
}

const PAGES: readonly OverridePage[] = [
  'home',
  'feedback',
  'roadmap',
  'changelog',
  'help',
  'support',
  'status',
  'post',
]
const isPage = (word: string | undefined): word is OverridePage =>
  !!word && (PAGES as readonly string[]).includes(word)

/** The one page a field of the design is drawn on, or null for one shared by every page. */
export function fieldPage(path: string): OverridePage | null {
  const title = /^pages\.titles\.(\w+)/.exec(path)
  if (title) return isPage(title[1]) ? title[1] : null
  const own = /^pages\.(\w+)/.exec(path)
  if (own) return isPage(own[1]) ? own[1] : null
  const background = /^layout\.pageBackgrounds\.(\w+)/.exec(path)
  if (background) return isPage(background[1]) ? background[1] : null
  return null
}

const stable = (value: unknown) => JSON.stringify(value ?? null)

/** The overrides one list has that the other has not, or holds otherwise. */
function changedOverrides(before: unknown, after: unknown): StyleOverride[] {
  const list = (value: unknown) => (Array.isArray(value) ? (value as StyleOverride[]) : [])
  const was = new Map(list(before).map((o) => [o.id, stable(o)]))
  const now = new Map(list(after).map((o) => [o.id, stable(o)]))
  return [
    ...list(after).filter((o) => was.get(o.id) !== stable(o)),
    ...list(before).filter((o) => !now.has(o.id)),
  ]
}

/** The pages each page background key changed is drawn on. */
function changedBackgrounds(before: unknown, after: unknown): string[] {
  const keyed = (value: unknown) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const [a, b] = [keyed(before), keyed(after)]
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => stable(a[key]) !== stable(b[key])
  )
}

/** The pages a change lands on: some, or every one. */
export function changePages(
  design: PortalDesign,
  change: { path: string; before: unknown; after: unknown }
): 'every' | Set<OverridePage> {
  if (change.path === 'overrides') {
    const parts = new Map(allPartsOf(design).map((part) => [part.id, part]))
    const pages = new Set<OverridePage>()
    for (const o of changedOverrides(change.before, change.after)) {
      if (o.target.scope === 'page') pages.add(o.target.page)
      else {
        const on = parts.get(o.target.part)?.pages ?? PAGES
        if (on.length !== 1) return 'every'
        pages.add(on[0]!)
      }
    }
    return pages
  }
  if (change.path === 'layout.pageBackgrounds') {
    const keys = changedBackgrounds(change.before, change.after)
    return keys.every(isPage) ? new Set(keys) : 'every'
  }
  const page = fieldPage(change.path)
  return page ? new Set([page]) : 'every'
}

/**
 * A short clause for a reply whose changes land beyond the page shown: "on
 * every page", or "on other pages too"; '' when they stay on it, and for
 * the whole site, its styles and parts that are on every page anyway.
 */
export function reachClause(
  design: PortalDesign,
  changes: ReadonlyArray<{ path: string; before: unknown; after: unknown }>,
  pick: { scope: DesignAiScope; page?: DesignerPage }
): string {
  if (pick.scope === 'site' || pick.scope === 'brand' || ON_EVERY_PAGE.has(pick.scope)) return ''
  let other = false
  for (const change of changes) {
    const pages = changePages(design, change)
    if (pages === 'every') return 'on every page'
    if (pick.page && [...pages].some((page) => page !== pick.page)) other = true
  }
  return other ? 'on other pages too' : ''
}

/** A sentence with the reach clause before its full stop; as it was when there is none. */
export function withReach(sentence: string, clause: string): string {
  const said = sentence.trim()
  if (!clause) return said
  return `${said.replace(/[.!]+$/, '')}, ${clause}.`
}

/**
 * What else the changes reach, for a pick narrower than the site: a shared
 * field's other parts ("Also changes the corners of cards, fields and
 * buttons."), said under Show changes.
 */
export function alsoNotes(
  changes: ReadonlyArray<Pick<AppliedDesignChange, 'path'>>,
  scope: DesignAiScope
): string[] {
  if (scope === 'site' || scope === 'brand') return []
  return [...new Set(changes.flatMap((change) => alsoChanges(change.path) ?? []))]
}

/** A reply's first sentence: replies are one line. */
export function oneSentence(text: string): string {
  const said = text.trim()
  const first = /^(.+?[.!?])\s+(?=[A-Z“"‘'(])/.exec(said)
  return first ? first[1]! : said
}

/**
 * What the model is told of how far a request may reach, beside what was
 * picked; '' for everywhere the pick is.
 */
export function reachNote(
  reach: AiReach | undefined,
  page: DesignerPage | undefined,
  part?: string | null
): string {
  if (!reach || reach === 'every') return ''
  if (reach === 'one' && part)
    return `Change just this one: op override with target part:${part}. Anything else is refused.`
  if (reach === 'one') return 'Change just the block picked. Anything else is refused.'
  if (!page) return ''
  return `Change it only on the ${PAGE_NAMES[page]} page: an override on its parts there (target part:<id>) or on the page (target page:${page}), or that page's own settings. Anything every page shares is refused.`
}
