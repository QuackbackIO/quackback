/**
 * The short summary Publish shows before a draft goes live: what happens to
 * the menu and where visitors land first, then the rest by the part it
 * changes. The full review opens instead when there is too much to sum up
 * or a check fails.
 */
import type { DesignChange } from './diff'
import { changeGroup, changeGroupOrder, changeLabel } from './labels'
import { landingOf } from './menu'
import { landingName } from './overview'
import { PAGE_NAMES } from './outline'
import { PAGE_PATHS, type PortalPageGates, type PortalPageType } from './paths'
import type { PortalDesign } from './schema'
import type { StyleOverride } from './style-overrides'
import {
  changedProps,
  orphanedOverrides,
  overrideName,
  overrideProps,
  propList,
} from './override-cascade'

/** Past this many changes, Publish opens the full review instead of the summary. */
export const FULL_REVIEW_OVER = 12

/** Whether Publish opens the full review in place of the summary. */
export function opensFullReview(changes: number, failingChecks: number): boolean {
  return changes > FULL_REVIEW_OVER || failingChecks > 0
}

/**
 * Why the full review opened in place of the summary, said first: a check
 * that needs a look. A long draft needs no reason; the title counts it.
 */
export function fullReviewReason(failing: number): string | undefined {
  if (failing <= 0) return undefined
  return failing === 1
    ? 'A check needs a look before you publish.'
    : `${failing} checks need a look before you publish.`
}

/**
 * Whether a draft's changes reach what visitors get beyond the portal: the
 * sign-in email and a shared link's preview, drawn from the brand's colours,
 * logo, title, fonts and share image.
 */
export function reachesVisitorExtras(changes: readonly DesignChange[]): boolean {
  return changes.some((change) =>
    /^brand(\.(light|dark|logo|fonts|shareImage)\b|$)/.test(change.path)
  )
}

export interface SummaryRow {
  /** What the row is about, such as Landing, Menu or a part of the portal. */
  kind: string
  title: string
  detail?: string
}

export interface PublishSummary {
  /** Where visitors land and what the menu shows, which matter most. */
  menu: SummaryRow[]
  /** Everything else, a row for each part of the portal it changes. */
  look: SummaryRow[]
  /** Looks set for one page or one part: added, changed, removed, and those nothing draws. */
  overrides: SummaryRow[]
}

type Page = Extract<PortalDesign['nav']['items'][number], { shown: boolean }>

const pagesOf = (design: PortalDesign) =>
  design.nav.items.filter((item): item is Page => item.type !== 'link')
const nameOf = (item: Page | undefined, type: PortalPageType) => item?.label ?? PAGE_NAMES[type]

function menuRows(live: PortalDesign, draft: PortalDesign, gates: PortalPageGates): SummaryRow[] {
  const rows: SummaryRow[] = []
  const [before, after] = [landingName(live, gates), landingName(draft, gates)]
  // A rename of the page visitors land on is a rename, not a move.
  if (landingOf(live, gates) !== landingOf(draft, gates))
    rows.push({
      kind: 'Landing',
      title: `Visitors land on ${after}`,
      detail: `Was ${before}. The logo goes there too.`,
    })
  if (live.nav.home.on !== draft.nav.home.on)
    rows.push({ kind: 'Menu', title: draft.nav.home.on ? 'Home turned on' : 'Home turned off' })
  else if (draft.nav.home.on) {
    const [old, home] = [live.nav.home, draft.nav.home]
    if (old.tab !== home.tab)
      rows.push(
        home.tab
          ? { kind: 'Menu', title: 'Home in the menu' }
          : {
              kind: 'Menu',
              title: 'Home out of the menu',
              detail: 'Still open at /, where the logo goes',
            }
      )
    const [oldName, name] = [old.label ?? 'Home', home.label ?? 'Home']
    if (oldName !== name) rows.push({ kind: 'Menu', title: `${oldName} renamed ${name}` })
  }
  const [was, now] = [pagesOf(live), pagesOf(draft)]
  for (const item of now) {
    if (!gates[item.type]) continue
    const old = was.find((each) => each.type === item.type)
    const name = nameOf(item, item.type)
    if ((old?.shown ?? false) !== item.shown)
      rows.push(
        item.shown
          ? { kind: 'Menu', title: `${name} in the menu` }
          : {
              kind: 'Menu',
              title: `${name} out of the menu`,
              detail: `Still open at ${PAGE_PATHS[item.type]}`,
            }
      )
    const oldName = nameOf(old, item.type)
    if (old && oldName !== name) rows.push({ kind: 'Menu', title: `${oldName} renamed ${name}` })
  }
  const order = (pages: Page[]) =>
    pages
      .filter((item) => gates[item.type])
      .map((item) => item.type)
      .join()
  if (order(was) !== order(now)) rows.push({ kind: 'Menu', title: 'Menu order changed' })
  const links = (design: PortalDesign) =>
    JSON.stringify(design.nav.items.filter((item) => item.type === 'link'))
  if (links(live) !== links(draft)) rows.push({ kind: 'Menu', title: 'Menu links changed' })
  return rows
}

/** Up to two names, then how many more. */
function named(labels: string[]): string {
  const shown = labels.slice(0, 2).join(', ')
  return labels.length > 2 ? `${shown} and ${labels.length - 2} more` : shown
}

export function publishSummary(
  live: PortalDesign,
  draft: PortalDesign,
  changes: readonly DesignChange[],
  gates: PortalPageGates
): PublishSummary {
  const groups = new Map<string, DesignChange[]>()
  for (const change of changes) {
    // The menu itself is summed up above, row by row.
    if (change.path === 'nav' || change.path.startsWith('nav.')) continue
    // Overrides are summed up on their own, one row for each.
    if (change.path === 'overrides' || change.path.startsWith('overrides.')) continue
    const group = changeGroup(change.path)
    groups.set(group, [...(groups.get(group) ?? []), change])
  }
  const look = [...groups.entries()]
    .sort(([a], [b]) => changeGroupOrder(a) - changeGroupOrder(b))
    .map(([group, list]) => ({
      kind: group,
      title: named([...new Set(list.map((change) => changeLabel(change.path)))]),
      detail: list.length === 1 ? '1 change' : `${list.length} changes`,
    }))
  return { menu: menuRows(live, draft, gates), look, overrides: overrideRows(live, draft) }
}

/**
 * A row for each override added, changed or removed, then one quiet line for
 * those whose part is gone, which publishing drops.
 */
function overrideRows(live: PortalDesign, draft: PortalDesign): SummaryRow[] {
  const orphans = orphanedOverrides(draft)
  const dropped = new Set(orphans.map((o) => o.id))
  const before = new Map((live.overrides ?? []).map((o) => [o.id, o]))
  const after = new Map(
    (draft.overrides ?? []).filter((o) => !dropped.has(o.id)).map((o) => [o.id, o])
  )
  const scope = (o: StyleOverride) => (o.target.scope === 'part' ? 'This one' : 'This page')
  const rows: SummaryRow[] = []
  for (const [id, o] of after) {
    const old = before.get(id)
    if (!old)
      rows.push({
        kind: 'Added',
        title: overrideName(draft, o),
        detail: `${scope(o)}: ${propList(overrideProps(o))}`,
      })
    else if (JSON.stringify(old) !== JSON.stringify(o))
      rows.push({
        kind: 'Changed',
        title: overrideName(draft, o),
        detail: `${scope(o)}: ${propList(changedProps(old, o))}`,
      })
  }
  for (const [id, o] of before)
    if (!after.has(id) && !dropped.has(id))
      rows.push({ kind: 'Removed', title: overrideName(live, o) })
  if (orphans.length)
    rows.push({
      kind: 'Dropped',
      title:
        orphans.length === 1
          ? overrideName(draft, orphans[0]!)
          : `${overrideName(draft, orphans[0]!)} and ${orphans.length - 1} more`,
      detail: 'Its part is gone',
    })
  const ORDER = ['Added', 'Changed', 'Removed', 'Dropped']
  return rows.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}
