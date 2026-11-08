/**
 * Quick find: every block, page and setting of the designer by name, and the
 * actions on blocks, so "favicon" or "button corners" leads straight to its
 * control. A setting names the block whose settings hold it and the label it
 * sits under there; a Home block's settings come from the block registry.
 */
import { blockOf } from './blocks'
import type { HomeBlockType } from './home'
import type { PortalDesign } from './schema'
import {
  blockKey,
  outlineKeys,
  PAGE_NAMES,
  type DesignerPage,
  type OutlineNode,
  type Selection,
} from './outline'
import { STYLE_ELEMENTS, STYLE_PROPS, type StyleElement, type StylePropInfo } from './style-tokens'

export type FindTarget =
  | { kind: 'part'; selection: Selection; page?: DesignerPage; setting?: string }
  | { kind: 'page'; page: DesignerPage }
  /** A setting of the element picked, in the panel already open. */
  | { kind: 'here'; setting: string }
  /** Something to do, such as duplicating the picked block. */
  | { kind: 'action'; run: () => void }

export type FindGroup = 'Blocks' | 'Settings' | 'Actions' | 'Pages'

export interface FindItem {
  group: FindGroup
  label: string
  /** The Home block it is, drawn as its icon. */
  icon?: HomeBlockType
  /** Where it is, such as the part a setting belongs to. */
  where?: string
  /** Other words it is found by. */
  terms?: string
  target: FindTarget
}

/**
 * A setting: its name, the part it is under, its label there, other words for
 * it, and the pages it shows on when not every page with the part.
 */
type Setting = [
  name: string,
  part: Selection,
  label: string,
  terms?: string,
  pages?: readonly DesignerPage[],
]

const SETTINGS: Setting[] = [
  ['Logo', 'site:brand', 'Title', 'icon mark wordmark name title'],
  ['Favicon', 'site:brand', 'Favicon', 'icon tab'],
  ['Share image', 'site:brand', 'Share image', 'social og'],
  ['Mode', 'site:brand', 'Appearance', 'light dark theme auto'],
  ['Brand colour', 'site:brand', 'Brand colour', 'accent primary'],
  ['Second colour', 'site:brand', 'Second colour', 'support'],
  ['Dark colours', 'site:brand', 'Dark mode', 'dark values night'],
  ['Logo colours', 'logo', 'Logo colours', 'status markers'],
  ['Fonts', 'site:brand', 'Fonts', 'typeface family body heading pair'],
  ['Upload a font', 'site:brand', 'Fonts', 'own font woff2'],
  ['Looks', 'site:brand', 'Look', 'preset theme start'],
  ['Headline colour', 'site:styles', 'Headlines', 'brand colour text'],
  ['Headline size', 'site:styles', 'Headline size', 'type scale large display'],
  ['Corners', 'site:brand', 'Corners', 'radius rounded'],
  ['Page width', 'site:styles', 'Page width', 'narrow wide'],
  ['Heading weight', 'site:brand', 'Heading weight', 'bold'],
  ['Capitals', 'site:styles', 'Menu and buttons in capitals', 'uppercase case'],
  ['Hover', 'site:styles', 'Hover', 'motion lift arrow'],
  ['Logo height', 'logo', 'Height', 'size'],
  ['Exact sizes', 'site:styles', 'Exact values', 'tune fine px'],
  ['Custom CSS', 'site:styles', 'Custom CSS', 'stylesheet code'],
  ['Own wording', 'site:words', 'Composer prompt', 'prompt submit button empty copy text'],
  ['Readability', 'site:brand', 'Colours', 'contrast hard to read'],
  ['Header layout', 'header', 'Layout', 'inline centred stacked'],
  ['Menu style', 'header', 'Menu style', 'tabs pills underline plain nav'],
  ['Menu position', 'header', 'Menu position', 'centre centered align'],
  ['Menu', 'header', 'Menu', 'links navigation'],
  ['Landing page', 'header', 'Landing page', 'home page first visitors land'],
  // The headline is edited on the page; the hero's panel holds its look.
  ['Headline', 'hero', 'Look', 'title words subtitle'],
  ['Hero look', 'hero', 'Look', 'band banner background top'],
  ['Hero image', 'hero', 'Image', 'photo picture band banner'],
  ['Hero art', 'hero', 'Art', 'pattern dots waves band'],
  ['Hero colour', 'hero', 'Colour', 'band background'],
  ['Hero height', 'hero', 'Height', 'band tall short'],
  ['Hero alignment', 'hero', 'Align', 'centre left text position'],
  ['Hero shape', 'hero', 'Shape', 'inset panel split'],
  ['Header blends into the hero', 'header', 'Blend into hero', 'header band colour'],
  ['Page titles', 'hero', 'Other pages', 'titles band'],
  ['Composer on Home', 'hero', 'Main action', 'composer post box band', ['home']],
  ['Call to action colour', 'hero', 'Button colour', 'button action band'],
  ['Cards', 'feed', 'Cards', 'posts list'],
  ['Density', 'feed', 'Density', 'spacing compact'],
  ['Default sort', 'feed', 'Sort', 'order trending top new'],
  ['Filters', 'filters', 'Side', 'sidebar boards'],
  ['Welcome message', 'welcome', 'Show', 'intro feed'],
]

/** The rows every Home block's panel has besides its registry settings: its layout and look. */
const BLOCK_ROWS: ReadonlyArray<[label: string, terms: string]> = [
  ['Width', 'size columns layout'],
  ['Background', 'card plain tint brand look'],
  ['Align', 'centre center start look'],
]

/** The pages a part is on; a part not listed is on every page. */
const PART_PAGES: Partial<Record<Selection, readonly DesignerPage[]>> = {
  hero: ['home', 'feedback', 'roadmap', 'changelog', 'help', 'support'],
  home: ['home'],
  welcome: ['feedback'],
  feed: ['feedback'],
  filters: ['feedback'],
}

/** The page to show a part on: this one if it has it, else the first page that does. */
function pageFor(
  part: Selection,
  page: DesignerPage,
  pages: readonly DesignerPage[],
  only?: readonly DesignerPage[]
): DesignerPage | null | undefined {
  const on = only ?? PART_PAGES[part]
  if (!on || on.includes(page)) return undefined
  return pages.find((each) => on.includes(each)) ?? null
}

/**
 * Everything quick find offers, from the outline of the page shown and the
 * pages there are; with the design, each Home block's own settings too.
 */
export function quickFindItems(
  nodes: readonly OutlineNode[],
  page: DesignerPage,
  pages: readonly DesignerPage[],
  design?: PortalDesign
): FindItem[] {
  const types = new Map<Selection, HomeBlockType>(
    (design?.pages.home.blocks ?? []).map((block, i) => [blockKey(block, i), block.type])
  )
  const names = new Map<Selection, string>()
  const parent = new Map<Selection, string>()
  for (const node of nodes) {
    names.set(node.key, node.label)
    for (const child of node.children ?? []) {
      names.set(child.key, child.label)
      parent.set(child.key, node.label)
    }
  }
  const parts: FindItem[] = outlineKeys(nodes).map((key) => ({
    group: 'Blocks',
    label: names.get(key)!,
    where: parent.get(key),
    ...(types.has(key) ? { icon: types.get(key) } : {}),
    target: { kind: 'part', selection: key },
  }))
  const settings: FindItem[] = []
  for (const [name, part, label, terms, only] of SETTINGS) {
    const goTo = pageFor(part, page, pages, only)
    if (goTo === null) continue
    settings.push({
      group: 'Settings',
      label: name,
      where: names.get(part) ?? partName(part),
      terms,
      target: { kind: 'part', selection: part, setting: label, ...(goTo ? { page: goTo } : {}) },
    })
  }
  if (design && pages.includes('home'))
    design.pages.home.blocks.forEach((block, i) => {
      const def = blockOf(block.type)
      if (!def || !block.id) return
      const where = `${def.name} on Home`
      const selection = blockKey(block, i)
      const rows: Array<[label: string, terms?: string]> = [
        ...def.fields
          .filter((field) => field.kind !== 'links' && field.kind !== 'image')
          .map((field): [string, string] => [
            field.kind === 'words' ? 'Message' : field.label,
            field.about.toLowerCase(),
          ]),
        ...BLOCK_ROWS,
      ]
      for (const [label, terms] of rows)
        settings.push({
          group: 'Settings',
          label,
          where,
          terms,
          icon: block.type,
          target: {
            kind: 'part',
            selection,
            setting: label,
            ...(page === 'home' ? {} : { page: 'home' as const }),
          },
        })
    })
  const pageItems: FindItem[] = pages.map((each) => ({
    group: 'Pages',
    label: PAGE_NAMES[each],
    target: { kind: 'page', page: each },
  }))
  return [...parts, ...pageItems, ...settings]
}

const PART_NAMES: Partial<Record<Selection, string>> = {
  hero: 'Hero',
  welcome: 'Welcome message',
  feed: 'Feed',
  filters: 'Filters',
}

const partName = (part: Selection) => PART_NAMES[part] ?? part

/**
 * The picked element's settings, each by the label its field shows, under
 * More or not: found in the panel already open.
 */
export function elementFindItems(element: StyleElement, name: string): FindItem[] {
  return STYLE_ELEMENTS[element].props.map((prop) => {
    const info: StylePropInfo = STYLE_PROPS[prop]
    const label = info.kind === 'number' && info.unit ? `${info.label} (${info.unit})` : info.label
    return {
      group: 'Settings' as const,
      label,
      where: name,
      terms: info.label.toLowerCase(),
      target: { kind: 'here' as const, setting: label },
    }
  })
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
}: {
  /** The picked Home block's name, or null with none picked. */
  picked: string | null
  onAdd: () => void
  onLayouts: () => void
  onDuplicate?: () => void
  onRemove?: () => void
}): FindItem[] {
  const action = (label: string, run: () => void, terms?: string): FindItem => ({
    group: 'Actions',
    label,
    terms,
    target: { kind: 'action', run },
  })
  return [
    action('Add a block…', onAdd, 'new insert block'),
    ...(picked && onDuplicate ? [action(`Duplicate ${picked}`, onDuplicate, 'copy')] : []),
    ...(picked && onRemove ? [action(`Remove ${picked}`, onRemove, 'delete')] : []),
    action('Start Home from a layout…', onLayouts, 'home layouts arrangement blocks'),
  ]
}
