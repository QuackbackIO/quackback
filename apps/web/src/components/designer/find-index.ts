/**
 * Quick find's index, generated from what draws the rows: Theme's sections
 * and the part panels (find-rows.ts), every element and each of its
 * properties (the element registry), Home blocks' and page sections'
 * settings (the block registry), the parts of the page shown and the pages.
 * Each entry has a readable path, "Theme › Style › Corners", and leads to
 * its row by the stable name the row is drawn with.
 */
import type { ThemeAt } from '@/lib/shared/design/builder-chrome'
import { sectionTypeOf } from '@/lib/shared/design/builder-chrome'
import { blockOf, sectionOf, type SettingField } from '@/lib/shared/design/blocks'
import type { HomeBlockType } from '@/lib/shared/design/home'
import {
  blockKey,
  outlineKeys,
  outlineOf,
  PAGE_NAMES,
  type DesignerPage,
  type OutlineNode,
  type Selection,
} from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  STYLE_ELEMENTS,
  styleAllows,
  type StyleElement,
  type StyleProp,
} from '@/lib/shared/design/style-tokens'
import { isContent, whenMet } from './block-settings-panel'
import {
  elementRowAka,
  elementRowFind,
  elementRowGroup,
  elementRowLabel,
  elementRowTerms,
  elementStyleFind,
  firstStateOf,
} from './element-rows'
import { CARD_TITLE_ROWS, choicesOf } from './element-style-section'
import {
  FIND,
  PAGE_PANEL,
  PART_PANELS,
  THEME_PANEL,
  blockFieldFind,
  type FindContext,
  type FindPanel,
  type PanelRow,
} from './find-rows'
import { THEME } from './properties/words'
import { stylesElements } from './styles-panel'

export type FindGroup = 'Blocks' | 'Settings' | 'Actions' | 'Pages'

/** Where a row is: in Theme (itself or an element's panel), in a part's panel (null: the page's own), or in the panel open now. */
export type FindPlace =
  | { kind: 'theme'; at: ThemeAt }
  | { kind: 'part'; selection: Selection | null; page: DesignerPage }
  | { kind: 'here' }

export type FindTarget =
  /** A row: its place, its stable name, and a disclosure to open first. */
  | { kind: 'row'; place: FindPlace; row: string; opens?: string }
  /** A part of the page shown, picked. */
  | { kind: 'part'; selection: Selection; page: DesignerPage }
  | { kind: 'page'; page: DesignerPage }
  /** Something to do, such as duplicating the picked block. */
  | { kind: 'action'; run: () => void }

export interface FindItem {
  /** Unique among the entries. */
  id: string
  group: FindGroup
  label: string
  /** Where it is, outermost first, without its own label: ["Theme", "Style"]. */
  path: readonly string[]
  /** The Home block it is, drawn as its icon. */
  icon?: HomeBlockType
  /** Other names it answers to, counted as its label. */
  aka?: string
  /** Other words it is found by. */
  terms?: string
  /** Why it cannot be gone to now, such as its page being off: listed greyed, with this said. */
  off?: string
  target: FindTarget
}

/** What a Home-only setting says while Home is off. */
export const ON_HOME_OFF = 'On Home, which is off'

/** How a path reads: "Theme › Style › Corners". */
export const findPath = (item: Pick<FindItem, 'path' | 'label'>) =>
  [...item.path, item.label].join(' › ')

/** What the index is built from. */
export interface FindSource {
  design: PortalDesign
  gates: PortalPageGates
  /** The outline of the page shown. */
  nodes: readonly OutlineNode[]
  page: DesignerPage
  /** The pages the builder shows. */
  pages: readonly DesignerPage[]
}

/** Theme's rows, then every element's. */
function themeItems(design: PortalDesign, gates: PortalPageGates, page: DesignerPage): FindItem[] {
  const at: FindContext = { design, gates, page }
  const items: FindItem[] = panelRows(THEME_PANEL, at).map(({ row, path }) => ({
    id: `theme:${row.id}`,
    group: 'Settings',
    label: row.label,
    path,
    terms: row.terms,
    target: {
      kind: 'row',
      place: { kind: 'theme', at: { element: null } },
      row: row.id,
      ...(row.opens ? { opens: row.opens } : {}),
    },
  }))
  for (const element of stylesElements(gates)) items.push(...elementItems(design, element))
  return items
}

/** The rows a panel draws in a context, each with its path. */
function panelRows(panel: FindPanel, at: FindContext) {
  return panel.sections.flatMap((section) =>
    section.rows
      .filter((row) => row.when?.(at) ?? true)
      .map((row) => ({
        row,
        path: section.title ? [panel.name, section.title] : [panel.name],
      }))
  )
}

/** The rows of an element's panel opened from Theme: its Style section's, then each property's. */
function elementItems(design: PortalDesign, element: StyleElement): FindItem[] {
  const el = STYLE_ELEMENTS[element]
  const path = [THEME.sections.elements, el.label]
  const entry = (row: string, label: string, terms: string, prop?: StyleProp): FindItem => {
    const state = prop ? firstStateOf(element, prop) : 'base'
    const group = prop && elementRowGroup(prop)
    const aka = prop && elementRowAka(prop)
    return {
      id: `element:${row}`,
      group: 'Settings',
      label,
      path: group ? [...path, group] : path,
      ...(aka ? { aka } : {}),
      terms: `element ${terms}`,
      target: {
        kind: 'row',
        place: { kind: 'theme', at: { element, state: state ?? 'base' } },
        row,
      },
    }
  }
  const style: FindItem[] = []
  if (element === 'headline' || element === 'heading')
    style.push(entry(elementStyleFind(element, 'Font'), 'Font', 'typeface family'))
  for (const choice of choicesOf(design, element).filter((each) => !each.prop))
    style.push(entry(elementStyleFind(element, choice.label), choice.label, 'style'))
  if (element === 'postCard')
    for (const row of CARD_TITLE_ROWS)
      style.push(entry(elementStyleFind(element, row.label), row.label, 'title'))
  const taken = new Set(style.map((item) => item.label))
  const props = (el.props as readonly StyleProp[])
    .filter((prop) => firstStateOf(element, prop) !== null)
    .filter((prop) => !taken.has(elementRowLabel(prop)))
    .map((prop) =>
      entry(elementRowFind(element, prop), elementRowLabel(prop), elementRowTerms(prop), prop)
    )
  return [...style, ...props]
}

/** The pages a part is on, by each page's outline. */
function partPages(design: PortalDesign, pages: readonly DesignerPage[]) {
  const on = new Map<string, DesignerPage[]>()
  for (const page of pages)
    for (const key of outlineKeys(outlineOf(design, page)))
      on.set(key, [...(on.get(key) ?? []), page])
  return on
}

/** The page to show a row on: this one if it is drawn here, else the first that draws it. */
const pageAmong = (page: DesignerPage, candidates: readonly DesignerPage[]) =>
  candidates.includes(page) ? page : candidates[0]

/** Where a row of a part's panel leads: to the part, on the page that draws it. */
const partTarget = (selection: Selection | null, row: PanelRow, to: DesignerPage): FindTarget => ({
  kind: 'row',
  place: { kind: 'part', selection, page: to },
  row: row.id,
  ...(row.opens ? { opens: row.opens } : {}),
})

/** Whether a row is on Home only, and Home is not among the pages shown. */
const homeOnly = (row: PanelRow, pages: readonly DesignerPage[]) =>
  !!row.pages?.length && row.pages.every((p) => p === 'home') && !pages.includes('home')

/** The words of the settings only Home has, which Turn on Home is found by too. */
export const HOME_ONLY_TERMS = [
  ...new Set(
    PART_PANELS.flatMap((panel) =>
      panel.sections.flatMap((section) =>
        section.rows
          .filter((row) => row.pages?.length && row.pages.every((p) => p === 'home'))
          .flatMap((row) => [row.label.toLowerCase(), row.terms ?? ''])
      )
    )
  ),
]
  .join(' ')
  .trim()

/** The part panels' rows and the page panel's, each on a page that draws it. */
function partItems(
  design: PortalDesign,
  gates: PortalPageGates,
  page: DesignerPage,
  pages: readonly DesignerPage[],
  on: Map<string, DesignerPage[]>
): FindItem[] {
  const items: FindItem[] = []
  for (const panel of PART_PANELS) {
    const has = on.get(panel.place as string) ?? []
    for (const section of panel.sections)
      for (const row of section.rows) {
        const to = pageAmong(page, row.pages ? has.filter((p) => row.pages!.includes(p)) : has)
        // A setting only Home has, while Home is off: listed, greyed, saying so.
        if (!to && homeOnly(row, pages)) {
          if (!(row.when?.({ design, gates, page: 'home' }) ?? true)) continue
          items.push({
            id: `part:${panel.place}:${row.id}`,
            group: 'Settings',
            label: row.label,
            path: section.title ? [panel.name, section.title] : [panel.name],
            terms: row.terms,
            off: ON_HOME_OFF,
            target: partTarget(panel.place as Selection, row, 'home'),
          })
          continue
        }
        if (!to || !(row.when?.({ design, gates, page: to }) ?? true)) continue
        items.push({
          id: `part:${panel.place}:${row.id}`,
          group: 'Settings',
          label: row.label,
          path: section.title ? [panel.name, section.title] : [panel.name],
          terms: row.terms,
          target: partTarget(panel.place as Selection, row, to),
        })
      }
  }
  for (const section of PAGE_PANEL.sections)
    for (const row of section.rows) {
      const to = pageAmong(page, row.pages ? pages.filter((p) => row.pages!.includes(p)) : [page])
      if (!to || !(row.when?.({ design, gates, page: to }) ?? true)) continue
      items.push({
        id: `page:${row.id}`,
        group: 'Settings',
        label: row.label,
        path: [PAGE_NAMES[to]],
        terms: `page ${row.terms ?? ''}`.trim(),
        target: partTarget(null, row, to),
      })
    }
  return items
}

/** The block registry's settings a block's panel draws: its content rows. */
const contentFields = (fields: readonly SettingField[], values: Record<string, unknown>) =>
  fields.filter(
    (field) =>
      isContent(field) &&
      whenMet(field, values) &&
      field.kind !== 'links' &&
      field.kind !== 'image' &&
      field.kind !== 'words'
  )

/** Each Home block's settings and each page section's, from the block registry. */
function blockItems(
  design: PortalDesign,
  page: DesignerPage,
  on: Map<string, DesignerPage[]>
): FindItem[] {
  const items: FindItem[] = []
  const blocks = design.pages.home.blocks
  for (const [key, has] of on) {
    const to = pageAmong(page, has)!
    const home = blocks.findIndex((block, i) => blockKey(block, i) === key)
    const section = home < 0 ? sectionTypeOf(key) : null
    const block = home >= 0 ? blocks[home] : section ? sectionOf(design, section) : null
    const def = block ? blockOf(block.type) : null
    if (!block || !def) continue
    const values = block as Record<string, unknown>
    const rows: PanelRow[] = contentFields(def.fields, values).map((field) => ({
      id: blockFieldFind(field.key),
      label: field.label,
      terms: field.about.toLowerCase(),
    }))
    if (block.type === 'ideas') rows.push(FIND.recentlyShipped)
    if (home >= 0 && blocks[home]!.id) {
      if (def.grid) rows.push(FIND.blockWidth)
      rows.push(FIND.blockBackground)
    }
    for (const row of rows)
      items.push({
        id: `block:${key}:${row.id}`,
        group: 'Settings',
        label: row.label,
        path: [PAGE_NAMES[to], def.name],
        terms: row.terms,
        ...(home >= 0 ? { icon: block.type as HomeBlockType } : {}),
        target: partTarget(key as Selection, row, to),
      })
  }
  return items
}

/**
 * Everything quick find offers: the parts of the page shown, the pages, and
 * every row of every panel, generated from what draws them.
 */
export function findIndex({ design, gates, nodes, page, pages }: FindSource): FindItem[] {
  const types = new Map<Selection, HomeBlockType>(
    design.pages.home.blocks.map((block, i) => [blockKey(block, i), block.type])
  )
  const parts: FindItem[] = []
  for (const node of nodes) {
    if (node.key === 'site') continue
    for (const [each, parent] of [
      [node, null] as const,
      ...(node.children ?? []).map((child) => [child, node.label] as const),
    ])
      parts.push({
        id: `pick:${each.key}`,
        group: 'Blocks',
        label: each.label,
        path: parent ? [parent] : [],
        ...(types.has(each.key) ? { icon: types.get(each.key) } : {}),
        target: { kind: 'part', selection: each.key, page },
      })
  }
  const pageItems: FindItem[] = pages.map((each) => ({
    id: `go:${each}`,
    group: 'Pages',
    label: PAGE_NAMES[each],
    path: [],
    terms: 'page',
    target: { kind: 'page', page: each },
  }))
  const on = partPages(design, pages)
  const settings = [
    ...themeItems(design, gates, page),
    ...partItems(design, gates, page, pages, on),
    ...blockItems(design, page, on),
  ]
  const seen = new Set<string>()
  return [...parts, ...pageItems, ...settings].filter((item) =>
    seen.has(item.id) ? false : (seen.add(item.id), true)
  )
}

/**
 * The picked element's rows, in the panel already open: each property it
 * has at rest, by its row's label, under the element's name.
 */
export function elementFindItems(element: StyleElement, name: string): FindItem[] {
  return (STYLE_ELEMENTS[element].props as readonly StyleProp[])
    .filter((prop) => styleAllows(element, 'base', prop))
    .map((prop) => ({
      id: `here:${elementRowFind(element, prop)}`,
      group: 'Settings' as const,
      label: elementRowLabel(prop),
      path: elementRowGroup(prop) ? [name, elementRowGroup(prop)!] : [name],
      ...(elementRowAka(prop) ? { aka: elementRowAka(prop) } : {}),
      terms: elementRowTerms(prop),
      target: {
        kind: 'row' as const,
        place: { kind: 'here' as const },
        row: elementRowFind(element, prop),
      },
    }))
}

/**
 * The actions quick find offers on Home's blocks: add one, duplicate or
 * remove the picked one by its name, and start Home from a layout.
 */
export function blockFindActions({
  picked,
  onAdd,
  onLayouts,
  onDuplicate,
  onRemove,
  onHome,
}: {
  /** The picked Home block's name, or null with none picked. */
  picked: string | null
  onAdd: () => void
  onLayouts: () => void
  onDuplicate?: () => void
  onRemove?: () => void
  /** Turns Home on, while it is off. */
  onHome?: () => void
}): FindItem[] {
  const action = (id: string, label: string, run: () => void, terms?: string): FindItem => ({
    id: `do:${id}`,
    group: 'Actions',
    label,
    path: [],
    terms,
    target: { kind: 'action', run },
  })
  return [
    action('add', 'Add a block…', onAdd, 'new insert block'),
    ...(picked && onDuplicate
      ? [action('duplicate', `Duplicate ${picked}`, onDuplicate, 'copy')]
      : []),
    ...(picked && onRemove ? [action('remove', `Remove ${picked}`, onRemove, 'delete')] : []),
    action('layouts', 'Start Home from a layout…', onLayouts, 'home layouts arrangement blocks'),
    // Found by Home's own settings too, so a search for one leads to a way to reach it.
    ...(onHome
      ? [action('home', 'Turn on Home', onHome, `landing page hero ${HOME_ONLY_TERMS}`)]
      : []),
  ]
}

/** Lower case, one spelling of colour, words only. */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/\bcolor/g, 'colour')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/** One word, without a plural s, so "buttons" finds "button" and the other way round. */
const stem = (word: string) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)

const meets = (have: readonly string[], want: string) =>
  have.some((word) => word.startsWith(want) || stem(word).startsWith(stem(want)))

/**
 * How well an entry answers a search, 0 for not at all: every word typed has
 * to start a word of its label, its path or its other words. A word in the
 * label counts most, then the path, then the other words; a label that
 * starts with what was typed comes first.
 */
export function findScore(
  item: Pick<FindItem, 'label' | 'path' | 'terms' | 'aka'>,
  search: string
): number {
  const wanted = words(search)
  if (!wanted.length) return 1
  const label = words(`${item.label} ${item.aka ?? ''}`)
  const path = words(item.path.join(' '))
  const terms = words(item.terms ?? '')
  let score = 0
  for (const want of wanted) {
    if (meets(label, want)) score += 3
    else if (meets(path, want)) score += 2
    else if (meets(terms, want)) score += 1
    else return 0
  }
  if (words(item.label).join(' ').startsWith(wanted.join(' '))) score += 2
  return score / (wanted.length * 3 + 2)
}
