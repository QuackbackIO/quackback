/**
 * The operations Quackback AI changes a portal design with, in place of
 * free-form field paths. Each names what a person would: a block by its id,
 * type or name, a place by the blocks around it ("beside:help_search"), a
 * size in words ("half", "wider"), a board or roadmap by its name, a menu
 * item by its label. Each resolves those words and then makes the builder's
 * own operation: a setting of a block, a page section or the hero, and a
 * block's removal, are the operations the builder's panels dispatch
 * (dispatch.ts); placing and sizing go through Home's grid, and the menu
 * through its steps. Each is checked as the builder checks a person's change, then
 * by the schema, the contrast solver and the checks on what the model may
 * bring. An operation never throws: it returns the design changed with a
 * label for its undo, or a refusal saying plainly why not.
 */
import {
  applySetting,
  blockOf,
  SECTION_TYPES,
  type BlockDef,
  type SectionType,
  type SettingField,
} from './blocks'
import {
  applyDesignChanges,
  designRefusal,
  pathInScope,
  type AppliedDesignChange,
  type DesignAiScope,
  type DesignValue,
  type UntrustedChanges,
} from './apply-changes'
import { applyDesignOp } from './dispatch'
import {
  gridItemsOf,
  HOME_BLOCKS_MAX,
  homeBlockTypes,
  newBlock,
  placeHomeBlocks,
  type HomeBlock,
  type HomeBlockType,
} from './home'
import {
  bottomOf,
  compact,
  GRID_COLUMNS,
  moveItem,
  readingOrder,
  resizeItem,
  type GridItem,
} from './home-grid'
import {
  headlineDoc,
  hasAccentMarkup,
  readHeadlineMarkup,
  isWordsDoc,
  keepColours,
  readRichMarkdown,
  type WordsDoc,
} from './rich-words'
import { checkedWords } from './words-schema'
import {
  setHeadline,
  wordsChangeLabel,
  wordsDocOf,
  type WordedPage,
  type WordsField,
} from './headline-words'
import { changeLabel } from './labels'
import { menuParts, type MenuPart, type MenuPartId } from './menu'
import {
  addLinkStep,
  landingStep,
  menuPlaceStep,
  menuStep,
  renameStep,
  type MenuStep,
  type MenuStepKind,
} from './menu-actions'
import { DESIGN_OPTIONS } from './options'
import { normaliseColor } from './color'
import { PAGE_NAMES } from './outline'
import {
  BACKGROUND_NAMES,
  backgroundLabel,
  backgroundOf,
  backgroundFillSchema,
  withBackground,
  writeBackground,
  type BackgroundKind,
  type BackgroundPage,
  type BackgroundTarget,
  type PageBackground,
} from './page-background'
import type { PortalPageGates, PortalPageType } from './paths'
import { portalDesign, type PortalDesign } from './schema'
import { THEME_FONTS, THEME_KEYS, themePath, type ThemeKeyName } from './theme-keys'
import {
  blockStylePath,
  readStyleValue,
  stylePath,
  type StyleElement,
  type StyleProp,
} from './style-tokens'
import { changePages, type AiReach } from './ai-reach'
import type { OverridePage } from './style-overrides'
import {
  overrideInReach,
  overrideInScope,
  overrideLabel,
  readOverrideOp,
  setAsOverride,
  writeOverride,
} from './override-ops'

/* The operations' shapes */

/** What an operation does. */
export const OP_KINDS = [
  'set',
  'theme',
  'words',
  'add',
  'move',
  'resize',
  'remove',
  'menu',
  'background',
  'override',
] as const
export type OpKind = (typeof OP_KINDS)[number]

/**
 * One operation as the model writes it, flat so its grammar stays small:
 * set (target a block, "hero" or a page; key a setting), theme (key a theme
 * setting), words (target a page; key title, subtitle, welcome, prompt,
 * submit or empty), add (key a block type; target a place), move (target a
 * block; value a place), resize (target a block; value a size), remove
 * (target a block), menu (target a menu item; key rename, hide, show, left,
 * right, first, last, land, remove or addlink), background (target "site" or
 * a page; key a kind, reset or dark; value its settings as JSON), override
 * (target a part, a page, a block or everywhere; key [phone.|dark.]<element>.
 * <state>.<prop>; override-ops.ts). A value is JSON or plain text.
 */
export interface FlatOp {
  op: OpKind
  target?: string
  key?: string
  value?: string
}

/** Something of the workspace's the AI picks by name: a board, a roadmap, a help topic. */
export interface NamedThing {
  id: string
  name: string
}

/** The workspace's boards, roadmaps and help topics, which settings name and the AI cannot invent. */
export interface AiPlaces {
  boards: readonly NamedThing[]
  roadmaps: readonly NamedThing[]
  categories: readonly NamedThing[]
  /** The public roadmaps' columns, each by its status. */
  columns?: readonly NamedThing[]
  /** The posts' statuses, such as Planned or Complete. */
  statuses?: readonly NamedThing[]
}

/** What a workspace has of one kind, none when it was not read. */
export const placesOf = (places: AiPlaces, source: keyof AiPlaces): readonly NamedThing[] =>
  places[source] ?? []

/** What an operation needs of the workspace. */
export interface OpWorld {
  gates: PortalPageGates
  places: AiPlaces
  /** The language words are written in; English when not given. */
  locale?: string
  /** Present for operations from the model: what it may bring in. */
  untrusted?: UntrustedChanges
  /** The person's request, where the operations answer one, which says whether colours are taken away. */
  request?: string
}

/** A request that takes colours away from words, or moves them, rather than adding to them. */
const TAKES_COLOURS =
  /\b(?:remove|removing|take (?:\w+ )?(?:off|away|out)|drop|no longer|instead|rather than|move|moving|only|uncolou?r|plain|clear|reset|without|strip|undo)\b/i

/**
 * The model's rewrite of rich words, with the colours it dropped on words it
 * did not touch kept, unless the request takes colours away.
 */
function withKeptColours(world: OpWorld, before: unknown, after: WordsDoc): WordsDoc {
  if (!world.untrusted || TAKES_COLOURS.test(world.request ?? '')) return after
  return isWordsDoc(before) ? keepColours(before, after) : after
}

export type OpResult =
  | {
      ok: true
      design: PortalDesign
      /** What it did, as its undo names it. */
      label: string
      /** False when the design already was so. */
      changed: boolean
    }
  | { ok: false; refusal: string }

const refuse = (refusal: string): OpResult => ({ ok: false, refusal })

/* Reading what the model wrote */

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[_\s-]+/g, ' ')
    .trim()

/** A value as written: JSON where it parses, else the text itself. */
export function readValue(value: string | undefined): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const listed = (words: readonly string[], or = 'or') =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} ${or} ${words.at(-1)}` : (words[0] ?? '')

const quoted = (text: string) => `“${text}”`

/* Finishing an operation */

const stable = (value: unknown): string =>
  JSON.stringify(value ?? null, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  )

/** The draft kept when the design's checks pass, with its label; else why not. */
function finish(
  before: PortalDesign,
  draft: PortalDesign,
  label: string,
  world: OpWorld
): OpResult {
  if (stable(before) === stable(draft)) return { ok: true, design: before, label, changed: false }
  const why = designRefusal(before, draft, world.untrusted)
  if (why) return refuse(why)
  return { ok: true, design: portalDesign.parse(draft), label, changed: true }
}

/** One design field set through the design's own shorthands and checks. */
function setPath(
  design: PortalDesign,
  world: OpWorld,
  path: string,
  value: unknown,
  label: string
): OpResult {
  // A person's change brings what it names; the model's only what it was given.
  const checks: UntrustedChanges = world.untrusted ?? {
    blockTypes: DESIGN_OPTIONS.blockType,
    links: new Set(urlsIn(value)),
    checkCss: () => null,
  }
  const result = applyDesignChanges(design, [{ path, value }], 'site', {
    ...checks,
    ...(world.locale ? { language: world.locale } : {}),
  })
  return outcome(design, result, label)
}

function outcome(
  design: PortalDesign,
  result: ReturnType<typeof applyDesignChanges>,
  label: string
): OpResult {
  const refused = result.refused[0]
  if (refused) return refuse(`${changeLabel(refused.path)}: ${refused.reason}`)
  return { ok: true, design: result.design, label, changed: result.applied.length > 0 }
}

function urlsIn(value: unknown): string[] {
  if (typeof value === 'string') return /^(https?:\/\/|mailto:)/.test(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(urlsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(urlsIn)
  return []
}

/* Home's blocks */

/** The block type a word names, by its type, name or another word for it. */
export function blockTypeOf(word: string): HomeBlockType | null {
  const want = norm(word)
  return (
    DESIGN_OPTIONS.blockType.find((type) => {
      const def = blockOf(type)!
      const names = [type, def.name, ...(def.aliases ?? [])]
      return names.some((name) => norm(name) === want)
    }) ?? null
  )
}

const blockName = (block: HomeBlock) => blockOf(block.type)!.name
const named = (block: HomeBlock) => `${blockName(block)} (${block.id})`

/** The Home block a reference names: its id, or its type or name where Home has one of it. */
export function findBlock(
  design: PortalDesign,
  ref: string | undefined
): { ok: true; block: HomeBlock; index: number } | { ok: false; refusal: string } {
  const blocks = design.pages.home.blocks
  const index = blocks.findIndex((block) => block.id === ref?.trim())
  if (index >= 0) return { ok: true, block: blocks[index]!, index }
  const type = ref ? blockTypeOf(ref) : null
  const all = blocks.map((block) => named(block)).join(', ')
  if (!type)
    return {
      ok: false,
      refusal: `Home has no block called ${ref ?? 'that'}; its blocks are ${all}`,
    }
  const matches = blocks.flatMap((block, at) => (block.type === type ? [at] : []))
  if (matches.length === 1) return { ok: true, block: blocks[matches[0]!]!, index: matches[0]! }
  const name = blockOf(type)!.name
  if (matches.length === 0)
    return { ok: false, refusal: `Home has no ${name} block; its blocks are ${all}` }
  return {
    ok: false,
    refusal: `Home has ${matches.length} ${name} blocks; name one by id: ${matches.map((at) => named(blocks[at]!)).join(', ')}`,
  }
}

/** The setting a key or a label names. */
function fieldOf(def: BlockDef, key: string | undefined): SettingField | null {
  if (!key) return null
  return (
    def.fields.find((field) => field.key === key) ??
    def.fields.find((field) => norm(field.label) === norm(key)) ??
    null
  )
}

/** A choice's value from its value or the name the panel gives it. */
function choiceValue(field: Extract<SettingField, { kind: 'choice' }>, value: unknown): unknown {
  if (typeof value !== 'string') return value
  return (
    field.options.find(([option]) => option === value)?.[0] ??
    field.options.find(
      ([option, name]) => norm(option) === norm(value) || norm(name) === norm(value)
    )?.[0] ??
    value
  )
}

const SOURCES = {
  boards: 'board',
  roadmaps: 'roadmap',
  categories: 'help topic',
  columns: 'roadmap column',
  statuses: 'status',
} as const

/** A kind of thing, more than one. */
const many = (kind: keyof typeof SOURCES) =>
  SOURCES[kind].endsWith('s') ? `${SOURCES[kind]}es` : `${SOURCES[kind]}s`

/** A workspace's thing by name or id, or why there is none. */
function pick(
  things: readonly NamedThing[],
  word: string,
  kind: keyof typeof SOURCES
): NamedThing | string {
  const found =
    things.find((thing) => thing.id === word) ??
    things.find((thing) => norm(thing.name) === norm(word)) ??
    things.find((thing) => norm(thing.name).startsWith(norm(word)))
  if (found) return found
  if (things.length === 0) return `This workspace has no public ${many(kind)}`
  return `There is no ${SOURCES[kind]} called ${quoted(word)}; there are ${listed(things.map((thing) => thing.name))}`
}

const ANY = new Set(['', 'all', 'any', 'every', 'none', 'first', 'default', 'usual', 'null'])

/**
 * A value as the setting takes it: numbers for a count, on or off for a
 * switch, a choice by its name, words as rich text, and boards, roadmaps and
 * topics by name as their ids. A string when it cannot be read.
 */
function settingValue(
  field: SettingField,
  value: unknown,
  places: AiPlaces
): { value: unknown } | { refusal: string } {
  switch (field.kind) {
    case 'count':
      return {
        value: typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value,
      }
    case 'switch': {
      const word = typeof value === 'string' ? norm(value) : value
      if (word === true || ['true', 'on', 'yes', 'show', 'shown'].includes(word as string))
        return { value: true }
      if (word === false || ['false', 'off', 'no', 'hide', 'hidden'].includes(word as string))
        return { value: false }
      return { value }
    }
    case 'choice':
      return { value: choiceValue(field, value) }
    case 'text':
      return { value: value === null ? '' : value }
    case 'words': {
      // Rich words as markdown, or a document, cut to what rich words hold.
      if (value && typeof value === 'object' && (value as WordsDoc).type === 'doc')
        return { value: checkedWords(value, 'rich') }
      if (typeof value !== 'string') return { value }
      const read = readRichMarkdown(value)
      return read.ok ? { value: checkedWords(read.doc, 'rich') } : { refusal: read.refusal }
    }
    case 'links': {
      const list = Array.isArray(value)
        ? value
        : value && typeof value === 'object'
          ? [value]
          : value
      return { value: list }
    }
    case 'source': {
      const things = placesOf(places, field.source)
      const words =
        value === null || value === undefined
          ? []
          : Array.isArray(value)
            ? value.map(String)
            : String(value)
                .split(',')
                .map((word) => word.trim())
      const wanted = words.filter((word) => !ANY.has(norm(word)))
      const ids: string[] = []
      for (const word of wanted) {
        const found = pick(things, word, field.source)
        if (typeof found === 'string') return { refusal: found }
        if (!ids.includes(found.id)) ids.push(found.id)
      }
      if (!field.multiple) {
        if (ids.length > 1) return { refusal: `${field.label} takes one ${SOURCES[field.source]}` }
        return { value: ids[0] ?? null }
      }
      if (field.max && ids.length > field.max)
        return { refusal: `${field.label} takes up to ${field.max} ${many(field.source)}` }
      return { value: ids }
    }
    case 'image':
      return { refusal: `${field.label}: upload images in the panel` }
  }
}

/** Brand images a Theme operation sets by a stored image's key. */
const STORED_IMAGES: Record<string, { path: string; label: string }> = {
  favicon: { path: 'brand.favicon', label: 'Favicon' },
  shareImage: { path: 'brand.shareImage', label: 'Share image' },
  logo: { path: 'brand.logo.mark.light', label: 'Logo icon' },
  wordmark: { path: 'brand.logo.wordmark.light', label: 'Full logo' },
}

/** A value as a person reads it in a label. */
function spokenValue(field: SettingField, value: unknown, places: AiPlaces): string {
  if (field.kind === 'choice')
    return field.options.find(([option]) => option === value)?.[1] ?? String(value)
  if (field.kind === 'switch') return value ? 'on' : 'off'
  if (field.kind === 'source') {
    const ids = Array.isArray(value) ? value : value ? [value] : []
    if (ids.length === 0) return field.any
    return listed(
      ids.map(
        (id) =>
          placesOf(places, field.source).find((thing) => thing.id === id)?.name ?? 'one chosen'
      ),
      'and'
    )
  }
  if (field.kind === 'words') return 'new words'
  if (field.kind === 'links') return 'new links'
  if (typeof value === 'string') return value ? quoted(value) : 'its usual'
  return String(value)
}

/** Sets one of a Home block's settings: setBlockSetting(blockId, key, value). */
export function setBlockSetting(
  design: PortalDesign,
  world: OpWorld,
  ref: string | undefined,
  key: string | undefined,
  value: unknown
): OpResult {
  const found = findBlock(design, ref)
  if (!found.ok) return refuse(found.refusal)
  const def = blockOf(found.block.type)!
  // The block's own look of what is in it: style.postCard.hover.background (style-tokens.ts).
  if (key && /^style\./.test(key)) {
    const at = blockStylePath(key)
    if (!at)
      return refuse(
        `${def.name}'s own look sets ${listed(['block', 'postCard', 'panel', 'heading', 'body', 'button', 'link', 'chip'])}, as style.<element>.<state>.<property>`
      )
    const read = readStyleValue(at.split('.').at(-1) as StyleProp, value)
    const draft = structuredClone(design)
    const block = draft.pages.home.blocks[found.index]!
    // Written in place, not by a path into the list, which is laid out again in reading order.
    const keys = at.split('.')
    let node = (block.look ??= {}) as Record<string, unknown>
    for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>
    if (read === null || read === undefined) delete node[keys.at(-1)!]
    else node[keys.at(-1)!] = read
    const spoken = read === null ? 'cleared' : typeof read === 'object' ? 'set' : String(read)
    // Its own container reads as the block itself: "Top posts: background #fef9c3".
    const named = at.startsWith('style.block.')
      ? changeLabel(at).replace(/^[^:]*: /, '')
      : changeLabel(at)
    return finish(design, draft, `${def.name}: ${named} ${spoken}`, world)
  }
  const field = fieldOf(def, key)
  if (!field)
    return refuse(`${def.name} has no setting called ${key ?? 'that'}; it has ${listed(def.ai)}`)
  if (!def.ai.includes(field.key))
    return refuse(`${def.name}’s ${field.label.toLowerCase()} is set in its panel`)
  const plain = field.kind === 'text' ? marksRefusal(field.label.toLowerCase(), value) : null
  if (plain) return refuse(plain)
  const read = settingValue(field, value, world.places)
  if ('refusal' in read) return refuse(read.refusal)
  if (field.kind === 'words' && isWordsDoc(read.value))
    read.value = checkedWords(
      withKeptColours(world, (found.block as Record<string, unknown>)[field.key], read.value),
      'rich'
    )
  const draft = structuredClone(design)
  const done = applyDesignOp(draft, {
    op: 'block.set',
    block: found.index,
    key: field.key,
    value: read.value,
    locale: world.locale,
  })
  if (!done.ok) return refuse(`${def.name}: ${done.refusal}`)
  // Rich words are labelled as the builder's editor labels them: their words, or their formatting.
  const label =
    field.kind === 'words'
      ? wordsChangeLabel(
          { kind: 'block', id: found.block.id ?? '', part: 'body' },
          ((found.block as Record<string, unknown>)[field.key] ?? EMPTY_DOC) as WordsDoc,
          read.value as WordsDoc
        )
      : `${def.name}: ${field.label} ${spokenValue(field, read.value, world.places)}`
  return finish(design, draft, label, world)
}

/* The hero */

/** Sets one of the hero's settings: setHero(key, value). Its looks reach every page. */
export function setHero(
  design: PortalDesign,
  world: OpWorld,
  key: string | undefined,
  value: unknown
): OpResult {
  const def = blockOf('hero')!
  const field = fieldOf(def, key)
  if (!field)
    return refuse(
      `The hero has no setting called ${key ?? 'that'}; it has ${listed(def.fields.map((f) => f.key))}`
    )
  const read = settingValue(field, value, world.places)
  if ('refusal' in read) return refuse(read.refusal)
  const draft = structuredClone(design)
  const done = applyDesignOp(draft, { op: 'hero.set', key: field.key, value: read.value })
  if (!done.ok) return refuse(`Hero: ${done.refusal}`)
  const label = `Hero ${field.label.toLowerCase()}: ${spokenValue(field, read.value, world.places)}`
  return finish(design, draft, label, world)
}

/* The pages' sections */

const CHOICE_PAGES = ['changelog', 'help', 'roadmap', 'post', 'support'] as const
/** Page settings that are no block of their own: each page's key, its field and its values. */
const PAGE_EXTRAS: Record<
  string,
  Record<string, { path: string; values: readonly string[]; label: string }>
> = {
  changelog: {
    subscribe: {
      path: 'pages.changelog.subscribe',
      values: DESIGN_OPTIONS.titleAction,
      label: 'Subscribe button',
    },
  },
  feedback: {
    sort: { path: 'pages.feedback.defaultSort', values: DESIGN_OPTIONS.sort, label: 'Feed order' },
  },
}

/** The board the feed opens on, picked by name like a block's board. */
const OPENS_ON: Extract<SettingField, { kind: 'source' }> = {
  kind: 'source',
  key: 'opensOn',
  label: 'Feed opens on',
  source: 'boards',
  multiple: false,
  any: 'All boards',
  about: 'The board the feed opens on when the address names none',
}

/** Opens the feed on one board, or on every board with none named. */
function setOpensOn(design: PortalDesign, world: OpWorld, value: unknown): OpResult {
  const every = typeof value === 'string' && /^(all|every|any)( boards?)?$/.test(norm(value))
  const read = every ? { value: null } : settingValue(OPENS_ON, value, world.places)
  if ('refusal' in read) return refuse(read.refusal)
  const draft = structuredClone(design)
  if (typeof read.value === 'string')
    draft.pages.feedback.openOn = read.value as PortalDesign['pages']['feedback']['openOn']
  else delete draft.pages.feedback.openOn
  return finish(
    design,
    draft,
    `${OPENS_ON.label}: ${spokenValue(OPENS_ON, read.value, world.places)}`,
    world
  )
}

/** The page a target names, such as "roadmap page", "page:help" or "help center". */
function pageOf(target: string | undefined): string | null {
  if (!target) return null
  const word = norm(target.replace(/^page:/, '')).replace(/ page$/, '')
  const section = SECTION_TYPES.find((type) => norm(type) === word)
  if (section) return section.split('.')[0]!
  if (word === 'help center' || word === 'help centre') return 'help'
  return [...CHOICE_PAGES, 'feedback'].includes(word as never) ? word : null
}

/** The page sections' settings, by page. */
export function pageSettings(page: string): string[] {
  const own = SECTION_TYPES.filter((type) => type.startsWith(`${page}.`)).flatMap((type) =>
    blockOf(type)!.fields.map((field) => field.key)
  )
  return [
    ...own,
    ...Object.keys(PAGE_EXTRAS[page] ?? {}),
    ...(page === 'feedback' ? [OPENS_ON.key] : []),
  ]
}

/** Sets one of a page's own settings: setPageSection(page, key, value). */
export function setPageSection(
  design: PortalDesign,
  world: OpWorld,
  page: string,
  key: string | undefined,
  value: unknown
): OpResult {
  const type = SECTION_TYPES.find(
    (each) => each.startsWith(`${page}.`) && fieldOf(blockOf(each)!, key)
  ) as SectionType | undefined
  if (type) {
    const def = blockOf(type)!
    const field = fieldOf(def, key)!
    const read = settingValue(field, value, world.places)
    if ('refusal' in read) return refuse(read.refusal)
    const draft = structuredClone(design)
    const done = applyDesignOp(draft, {
      op: 'section.set',
      type,
      key: field.key,
      value: read.value,
    })
    if (!done.ok)
      return refuse(
        `${PAGE_NAMES[page as PortalPageType]} ${def.name.toLowerCase()}: ${done.refusal}`
      )
    const label = `${PAGE_NAMES[page as PortalPageType]} ${field.label.toLowerCase()}: ${spokenValue(field, read.value, world.places)}`
    return finish(design, draft, label, world)
  }
  if (page === 'feedback' && key === OPENS_ON.key) return setOpensOn(design, world, value)
  const extra = key ? PAGE_EXTRAS[page]?.[key] : undefined
  if (extra) {
    if (!extra.values.includes(value as string))
      return refuse(`${extra.label} can be ${listed(extra.values)}`)
    return setPath(design, world, extra.path, value, `${extra.label}: ${String(value)}`)
  }
  const name = PAGE_NAMES[page as PortalPageType] ?? page
  return refuse(
    `The ${name} page has no setting called ${key ?? 'that'}; it has ${listed(pageSettings(page))}`
  )
}

/* Theme */

const THEME_ALIASES: Record<string, ThemeKeyName> = {
  'brand colour': 'accent',
  'brand color': 'accent',
  primary: 'accent',
  'second colour': 'support',
  'second color': 'support',
  ink: 'text',
  'text colour': 'text',
  'page colour': 'background',
  'heading font': 'headingFont',
  'body font': 'bodyFont',
  nav: 'menuStyle',
  menu: 'menuStyle',
}

/** The theme key a word names. */
function themeKeyOf(key: string): string {
  if (themePath(key)) return key
  const word = norm(key)
  return (
    THEME_ALIASES[word] ??
    (Object.keys(THEME_KEYS) as ThemeKeyName[]).find(
      (name) => norm(name) === word.replace(/ /g, '')
    ) ??
    key
  )
}

/** A font id from its id or its name, such as "IBM Plex Sans". */
function fontId(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const want = norm(value).replace(/ /g, '')
  return THEME_FONTS.find((id) => norm(id).replace(/ /g, '') === want) ?? value
}

/** The exact-value parts by the element whose style draws the same. */
const TUNE_ELEMENT: Record<string, string> = {
  headline: 'headline',
  heading: 'heading',
  subtitle: 'subtitle',
  body: 'body',
  link: 'link',
  button: 'button',
  card: 'postCard',
  field: 'input',
  secondary: 'secondary',
  label: 'navItem',
}
const TUNE_PROP: Record<string, string> = { colour: 'color', border: 'borderWidth' }

/** `body.colour`, which no exact value is, as the style that is: style.body.base.color. */
function tuneAsStyle(key: string): string | null {
  const m = /^(?:tune\.)?(\w+)\.(\w+)$/.exec(key)
  // A part by the exact values' name, or an element by the styles' own (image.radius).
  const element = m && (TUNE_ELEMENT[m[1]!] ?? m[1]!)
  if (!m || !element) return null
  return stylePath(`style.${element}.base.${TUNE_PROP[m[2]!] ?? m[2]!}`)
}

/** Sets a brand-wide setting by its name in Theme: setTheme(key, value). */
export function setTheme(
  design: PortalDesign,
  world: OpWorld,
  key: string | undefined,
  value: unknown
): OpResult {
  // The CSS check decides whether this workspace takes CSS, and which.
  if (key === 'css') return setPath(design, world, 'css', value, 'Custom CSS')
  // A brand image stored for this workspace (a website's favicon or logo, read
  // by read_website), by its key; the model never brings any other.
  const image = key ? STORED_IMAGES[key.replace(/^brand\./, '')] : undefined
  if (image) {
    const stored = typeof value === 'string' ? value : (value as { key?: unknown } | null)?.key
    if (typeof stored !== 'string' || !stored)
      return refuse(`${image.label} takes a stored image's key, such as {"key":"logos/..."}`)
    return setPath(design, world, image.path, { key: stored }, image.label)
  }
  const name = key ? themeKeyOf(key) : ''
  const path = themePath(name)
  // A group of exact values at once, {"underline":"hover"}: each in turn.
  const group = /^(?:tune\.)?(\w+)$/.exec(key ?? '')?.[1]
  if (!path && group && value && typeof value === 'object' && !Array.isArray(value)) {
    let at: OpResult = { ok: true, design, label: '', changed: false }
    const labels: string[] = []
    for (const [field, each] of Object.entries(value as Record<string, unknown>)) {
      at = setTheme(at.ok ? at.design : design, world, `${group}.${field}`, each)
      if (!at.ok) return at
      labels.push(at.label)
    }
    return { ...at, label: labels.join('; ') } as OpResult
  }
  // An exact value the design has none of, but a style has: the element's look, at rest.
  const asStyle = !path && key ? tuneAsStyle(key) : null
  if (asStyle) return setTheme(design, world, asStyle, value)
  if (!path)
    return refuse(
      `Theme has no setting called ${key ?? 'that'}; it has ${listed(Object.keys(THEME_KEYS))}, and exact values such as headline.size`
    )
  const theme = (THEME_KEYS as Record<string, (typeof THEME_KEYS)[ThemeKeyName]>)[name]
  let next = value
  if (theme?.values.kind === 'choice') {
    const values = Object.keys(theme.values.looks)
    const found = values.find((option) => norm(option) === norm(String(value)))
    // Headlines in lower case or capitalised are their style's, which the choice has no step for.
    if (!found && name === 'headlineCase' && ['lower', 'capitalize'].includes(norm(String(value))))
      return setTheme(design, world, 'style.headline.base.case', norm(String(value)))
    if (!found) return refuse(`${changeLabel(path)} can be ${listed(values)}`)
    next = name === 'headingWeight' ? Number(found) : found
  }
  if (theme?.values.kind === 'font') next = value === null ? null : fontId(value)
  if (
    theme?.values.kind === 'font' &&
    typeof next === 'string' &&
    !THEME_FONTS.includes(next as never)
  )
    return refuse(`${changeLabel(path)} can be one of the bundled fonts: ${THEME_FONTS.join(', ')}`)
  // A number, as written with or without its unit: 0.1em, 24px.
  if (
    /^tune\./.test(path) &&
    typeof next === 'string' &&
    /^-?\d+(\.\d+)?(px|em)?$/.test(next.trim())
  )
    next = parseFloat(next)
  if (/^style(Dark)?\./.test(path)) next = readStyleValue(path.split('.').at(-1) as StyleProp, next)
  const spoken = next === null ? 'cleared' : typeof next === 'object' ? 'set' : String(next)
  return setPath(design, world, path, next, `${changeLabel(path)} to ${spoken}`)
}

/* Words */

const TITLED = ['roadmap', 'changelog', 'help', 'support'] as const
const EMPTY_DOC: WordsDoc = { type: 'doc', content: [] }

/** Bold, italic or a link in markdown, which plain words do not take. */
const RICH_MARKUP = /\*\*\S[^*]*\*\*|(^|[\s(])\*\S[^*\n]*\*|\[[^\]\n]+\]\([^)\s]*\)/

/**
 * Why words written with marks cannot go on a field of plain words (a
 * subtitle, a heading, the composer's words), or null when they are plain.
 */
export function marksRefusal(name: string, value: unknown): string | null {
  if (typeof value !== 'string' || !(hasAccentMarkup(value) || RICH_MARKUP.test(value))) return null
  return `The ${name} is plain words: only a headline or a page title sets a phrase apart, and only Welcome words take bold, italics and links`
}

/**
 * Sets a page's headline or title from its markup: plain words, or one
 * phrase set apart as [words]{accent}, {highlight} or {lighter}. Plain words
 * leave no phrase set apart, as the builder's editor does.
 */
function setTitle(
  design: PortalDesign,
  world: OpWorld,
  page: WordedPage,
  text: string,
  wordsLabel: (title: string) => string
): OpResult {
  const read = readHeadlineMarkup(text)
  if (!read.ok) return refuse(read.refusal)
  const locale = world.locale ?? 'en'
  const field: WordsField = { kind: 'page', page, part: 'title' }
  const draft = structuredClone(design)
  setHeadline(draft, page, locale, read.words)
  const label = wordsChangeLabel(field, wordsDocOf(design, field, locale), headlineDoc(read.words))
  return finish(
    design,
    draft,
    // Only the phrase set apart changed: named by its kind, as the editor names it.
    label.endsWith(': words') ? wordsLabel(read.words.title) : label,
    world
  )
}
const COPY_KEYS: Record<string, string> = {
  prompt: 'prompt',
  submit: 'submit',
  empty: 'emptyTitle',
  emptytitle: 'emptyTitle',
}

/** Sets a page's words: setWords(page, title | subtitle | welcome | prompt | submit | empty, text). */
export function setWords(
  design: PortalDesign,
  world: OpWorld,
  target: string | undefined,
  key: string | undefined,
  value: unknown
): OpResult {
  const page = norm(target ?? '')
    .replace(/ page$/, '')
    .replace(/^help cent(er|re)$/, 'help')
  const what = norm(key ?? '').replace(/ /g, '')
  if (typeof value !== 'string' && value !== null) return refuse('Words are plain text')
  const text = value ?? ''
  const name = PAGE_NAMES[page as PortalPageType] ?? page
  const said = (part: string, words: string) =>
    `${name} ${part}: ${words ? quoted(words) : 'its usual'}`
  const label = (part: string) => said(part, text)
  const worded: WordedPage | null =
    page === 'home' || page === 'feedback' || (TITLED as readonly string[]).includes(page)
      ? (page as WordedPage)
      : null
  if (worded && (what === 'title' || what === 'headline')) {
    const part = worded === 'home' || worded === 'feedback' ? 'headline' : 'title'
    return setTitle(design, world, worded, text, (title) => said(part, title))
  }
  if (worded && what === 'subtitle') {
    const plain = marksRefusal('subtitle', text)
    if (plain) return refuse(plain)
    const path =
      worded === 'home' || worded === 'feedback'
        ? `pages.${worded}.headline.subtitle`
        : `pages.titles.${worded}.subtitle`
    return setPath(design, world, path, text, label('subtitle'))
  }
  if (page === 'feedback' && what === 'welcome') {
    // The welcome message is rich words: markdown with bold, italics, links and lists.
    const read = readRichMarkdown(text)
    if (!read.ok) return refuse(read.refusal)
    const doc = checkedWords(
      withKeptColours(world, design.pages.feedback.welcome.body, checkedWords(read.doc, 'rich')),
      'rich'
    )
    const formatting = wordsChangeLabel(
      { kind: 'welcome' },
      design.pages.feedback.welcome.body as WordsDoc,
      doc
    )
    const welcomeLabel = formatting.endsWith(': formatting') ? formatting : label('welcome message')
    const show = setPath(design, world, 'pages.feedback.welcome.show', !!text, welcomeLabel)
    if (!show.ok || !text) return show
    const body = setPath(show.design, world, 'pages.feedback.welcome.body', doc, welcomeLabel)
    return body.ok ? { ...body, changed: show.changed || body.changed } : body
  }
  if (page === 'feedback' && COPY_KEYS[what]) {
    const plain = marksRefusal(`composer ${what}`, text)
    if (plain) return refuse(plain)
    return setPath(
      design,
      world,
      `pages.feedback.copy.${COPY_KEYS[what]}`,
      text,
      label(`composer ${what}`)
    )
  }
  if (page === 'home' && what === 'welcome')
    return refuse('Home’s welcome is a block: set its body with set on the Welcome block')
  return refuse(
    `Words go on a page's title or subtitle (home, feedback, roadmap, changelog, help, support), or the feedback page's welcome, prompt, submit or empty`
  )
}

/* Home's grid */

/** Where a block goes, as the model names it. */
export type Place =
  | { kind: 'top' }
  | { kind: 'bottom' }
  | { kind: 'above' | 'below' | 'beside'; ref: string }
  | { kind: 'at'; x: number; y: number }

const PLACE_WORDS: Record<string, 'above' | 'below' | 'beside'> = {
  above: 'above',
  before: 'above',
  over: 'above',
  below: 'below',
  after: 'below',
  under: 'below',
  beside: 'beside',
  'next to': 'beside',
  'left of': 'beside',
  'right of': 'beside',
  with: 'beside',
}

/** A place from "top", "bottom", "beside:<block>", "below:<block>", "above:<block>" or "at:x,y". */
export function readPlace(text: string | undefined): Place | null {
  if (!text) return null
  const word = text.trim()
  if (/^(top|first|start)$/i.test(word)) return { kind: 'top' }
  if (/^(bottom|last|end)$/i.test(word)) return { kind: 'bottom' }
  const at = /^at:\s*(\d+)\s*,\s*(\d+)$/i.exec(word)
  if (at) return { kind: 'at', x: Number(at[1]), y: Number(at[2]) }
  const relative = /^([a-z ]+?)\s*:\s*(.+)$/i.exec(word)
  const kind = relative ? PLACE_WORDS[norm(relative[1]!)] : undefined
  return kind ? { kind, ref: relative![2]!.trim() } : null
}

const PLACE_HELP = 'top, bottom, above:<block>, below:<block> or beside:<block>'

/** A place in words, for a label. */
function placeWords(design: PortalDesign, place: Place): string {
  if (place.kind === 'top' || place.kind === 'bottom') return `to the ${place.kind}`
  if (place.kind === 'at') return `to column ${place.x + 1}, row ${place.y + 1}`
  const ref = findBlock(design, place.ref)
  const name = ref.ok ? blockName(ref.block) : place.ref
  return place.kind === 'beside' ? `beside ${name}` : `${place.kind} ${name}`
}

const replaceItem = (items: readonly GridItem[], next: GridItem) =>
  items.map((item) => (item.id === next.id ? next : item))

/**
 * Puts the Home block with this id at a place: lifted out from where it is,
 * then moved up into its place, pushing what is there down, as a drag does.
 * Beside a block it takes the room left in that block's row, or shares the
 * row, both kept at least their least widths. A reason when it cannot.
 */
function placeIn(draft: PortalDesign, id: string, place: Place): string | null {
  const items = gridItemsOf(draft.pages.home.blocks)
  const mine = items.find((item) => item.id === id)!
  const others = compact(items.filter((item) => item.id !== id))
  let lifted: GridItem[] = [...others, { ...mine, x: 0, y: bottomOf(others) }]
  const x = (at: number, w: number) => Math.max(0, Math.min(at, GRID_COLUMNS - w))
  let next: GridItem[]
  switch (place.kind) {
    case 'top':
      next = moveItem(lifted, id, 0, 0)
      break
    case 'bottom':
      next = lifted
      break
    case 'at':
      next = moveItem(lifted, id, place.x, place.y)
      break
    default: {
      const found = findBlock(draft, place.ref)
      if (!found.ok) return found.refusal
      const refId = found.block.id!
      if (refId === id) return 'A block cannot be placed beside itself'
      const ref = lifted.find((item) => item.id === refId)!
      if (place.kind === 'above') next = moveItem(lifted, id, x(ref.x, mine.w), ref.y)
      else if (place.kind === 'below') next = moveItem(lifted, id, x(ref.x, mine.w), ref.y + ref.h)
      else {
        let w = mine.w
        let at: number
        if (ref.x + ref.w + w <= GRID_COLUMNS) at = ref.x + ref.w
        else if (ref.x - w >= 0) at = ref.x - w
        else {
          // Share the row: each at least its least width, the moved block at most half.
          const refMin = ref.minW ?? 1
          w = Math.max(mine.minW ?? 1, Math.min(w, GRID_COLUMNS - refMin, GRID_COLUMNS / 2))
          if (w + refMin > GRID_COLUMNS)
            return `${blockOf(found.block.type)!.name} and this block do not fit side by side`
          const refW = Math.min(ref.w, GRID_COLUMNS - w)
          lifted = replaceItem(lifted, { ...ref, x: 0, w: refW })
          at = refW
        }
        lifted = replaceItem(lifted, { ...lifted.find((item) => item.id === id)!, w })
        next = moveItem(lifted, id, at, ref.y)
      }
    }
  }
  placeHomeBlocks(draft, compact(next))
  return null
}

/** Adds a block of a type to Home at a place, with settings: addBlock(type, place, settings). */
export function addBlock(
  design: PortalDesign,
  world: OpWorld,
  typeWord: string | undefined,
  placeText?: string,
  settings?: unknown
): OpResult {
  const type = typeWord ? blockTypeOf(typeWord) : null
  if (!type)
    return refuse(
      `There is no ${typeWord ?? ''} block; Home takes ${listed([...DESIGN_OPTIONS.blockType])}`
    )
  const def = blockOf(type)!
  const allowed = world.untrusted?.blockTypes ?? homeBlockTypes(world.gates)
  if (!allowed.includes(type)) return refuse(`${def.name} needs its page on`)
  const blocks = design.pages.home.blocks
  if (blocks.length >= HOME_BLOCKS_MAX)
    return refuse(`Home holds at most ${HOME_BLOCKS_MAX} blocks`)
  const there = blocks.find((block) => block.type === type)
  if (def.repeat === 'once' && there)
    return refuse(`Home already has ${named(there)}, and holds one; move it instead`)
  const place = placeText ? readPlace(placeText) : { kind: 'bottom' as const }
  if (!place) return refuse(`A place is ${PLACE_HELP}`)
  let block: HomeBlock = newBlock(type, { x: 0, y: bottomOf(blocks.map((each) => each.grid)) })
  if (settings !== undefined && settings !== null && settings !== '') {
    if (typeof settings !== 'object' || Array.isArray(settings))
      return refuse(`A new block’s settings are an object, such as {"count":5}`)
    for (const [key, value] of Object.entries(settings)) {
      const field = fieldOf(def, key)
      if (!field || !def.ai.includes(field.key))
        return refuse(`${def.name} has no setting called ${key}; it has ${listed(def.ai)}`)
      const read = settingValue(field, value, world.places)
      if ('refusal' in read) return refuse(read.refusal)
      const next = applySetting(block, field.key, read.value, world.locale)
      if (!next.ok) return refuse(`${def.name}: ${next.refusal}`)
      block = next.block
    }
  }
  const draft = structuredClone(design)
  draft.pages.home.blocks.push(block)
  const why = placeIn(draft, block.id!, place)
  if (why) return refuse(why)
  return finish(design, draft, `Add ${def.name} ${placeWords(draft, place)}`, world)
}

/** Moves a Home block to a place named by the blocks around it: moveBlock(blockId, place). */
export function moveBlock(
  design: PortalDesign,
  world: OpWorld,
  ref: string | undefined,
  placeText: string | undefined
): OpResult {
  const found = findBlock(design, ref)
  if (!found.ok) return refuse(found.refusal)
  const place = readPlace(placeText)
  if (!place) return refuse(`A place is ${PLACE_HELP}`)
  const draft = structuredClone(design)
  const why = placeIn(draft, found.block.id!, place)
  if (why) return refuse(why)
  return finish(design, draft, `Move ${blockName(found.block)} ${placeWords(design, place)}`, world)
}

/** Widths in words, in columns of twelve. */
const WIDTHS: Record<string, number> = {
  full: 12,
  'full width': 12,
  whole: 12,
  half: 6,
  third: 4,
  'a third': 4,
  'two thirds': 8,
  quarter: 3,
  'three quarters': 9,
}
const STEPS = [3, 4, 6, 8, 12]

const widthWords = (w: number) =>
  w === 12
    ? 'full width'
    : w === 6
      ? 'half width'
      : w === 4
        ? 'a third wide'
        : w === 8
          ? 'two thirds wide'
          : `${w} columns wide`

/** Resizes a Home block: resizeBlock(blockId, size), a size in words or columns. */
export function resizeBlock(
  design: PortalDesign,
  world: OpWorld,
  ref: string | undefined,
  size: unknown
): OpResult {
  const found = findBlock(design, ref)
  if (!found.ok) return refuse(found.refusal)
  const { block } = found
  const def = blockOf(block.type)!
  const { minW, minH } = def.grid!
  let { w, h } = block.grid
  const word = typeof size === 'string' ? norm(size) : null
  if (word && WIDTHS[word]) w = WIDTHS[word]
  else if (word === 'wider') {
    const up = STEPS.find((step) => step > w)
    if (!up) return refuse(`${def.name} is already full width`)
    w = up
  } else if (word === 'narrower') {
    const down = [...STEPS].reverse().find((step) => step < w)
    if (!down || down < minW) return refuse(`${def.name} is at its narrowest, ${minW} columns`)
    w = down
  } else if (word === 'taller') h += 1
  else if (word === 'shorter') h -= 1
  else if (typeof size === 'number' || (word && /^\d+$/.test(word))) w = Number(size)
  else if (word && /^\d+ ?x ?\d+$/.test(word))
    [w, h] = word.split('x').map((n) => Number(n.trim())) as [number, number]
  else if (size && typeof size === 'object' && !Array.isArray(size)) {
    const given = size as { w?: unknown; h?: unknown }
    if (typeof given.w === 'number') w = given.w
    if (typeof given.h === 'number') h = given.h
  } else
    return refuse(
      'A size is full, half, third, two thirds, wider, narrower, taller, shorter or a number of columns'
    )
  if (w < minW) return refuse(`${def.name} is at least ${minW} columns wide`)
  if (h < minH) return refuse(`${def.name} is at least ${minH} row tall`)
  w = Math.min(w, GRID_COLUMNS)
  const draft = structuredClone(design)
  const id = block.id!
  let items = gridItemsOf(draft.pages.home.blocks)
  const from = items.find((item) => item.id === id)!
  // A block grown past the page's edge moves left to fit.
  if (from.x + w > GRID_COLUMNS) items = moveItem(items, id, GRID_COLUMNS - w, from.y)
  placeHomeBlocks(draft, resizeItem(items, id, w, h))
  return finish(
    design,
    draft,
    `Make ${def.name} ${widthWords(w)}${h !== block.grid.h ? `, ${h} rows tall` : ''}`,
    world
  )
}

/** Takes a block off Home: removeBlock(blockId). */
export function removeBlock(
  design: PortalDesign,
  world: OpWorld,
  ref: string | undefined
): OpResult {
  const found = findBlock(design, ref)
  if (!found.ok) return refuse(found.refusal)
  const draft = structuredClone(design)
  applyDesignOp(draft, { op: 'block.remove', block: found.index })
  return finish(design, draft, `Remove ${blockName(found.block)}`, world)
}

/* The menu */

/** The menu item a word names: its id, its label, or its page's own name. */
function findMenuPart(
  design: PortalDesign,
  gates: PortalPageGates,
  ref: string | undefined
): MenuPart | null {
  if (!ref) return null
  const parts = menuParts(design, gates)
  const want = norm(ref)
  return (
    parts.find((part) => part.id === ref.trim()) ??
    parts.find((part) => norm(part.label) === want) ??
    parts.find(
      (part) => part.kind !== 'link' && norm(PAGE_NAMES[part.id as PortalPageType] ?? '') === want
    ) ??
    parts.find((part) => part.id.startsWith('link:') && norm(part.id.slice(5)) === want) ??
    null
  )
}

const MENU_ACTIONS = [
  'rename',
  'hide',
  'show',
  'left',
  'right',
  'first',
  'last',
  'land',
  'remove',
  'addlink',
] as const

/**
 * Changes the portal's menu: menuOp(item, action, value), where action is
 * rename (value the new name), hide, show, left, right, first, last, land
 * (the first page visitors see), remove (a link) or addlink (item the
 * label, value the address). Built on the menu's own steps.
 */
export function menuOp(
  design: PortalDesign,
  world: OpWorld,
  ref: string | undefined,
  action: string | undefined,
  value?: unknown
): OpResult {
  const { gates } = world
  const act = norm(action ?? '').replace(/ /g, '')
  const kind =
    ({ up: 'left', down: 'right', moveleft: 'left', moveright: 'right' } as Record<string, string>)[
      act
    ] ?? act
  if (!(MENU_ACTIONS as readonly string[]).includes(kind))
    return refuse(`A menu change is ${listed([...MENU_ACTIONS])}`)
  if (kind === 'addlink') {
    if (typeof value !== 'string' || !ref) return refuse('A new link needs a label and an address')
    return run(design, world, addLinkStep({ label: ref, url: value }), 'That link cannot be added')
  }
  const isHome = norm(ref ?? '') === 'home'
  if (isHome && !design.nav.home.on && (kind === 'show' || kind === 'land'))
    return run(design, world, landingStep(design, gates, 'home'), 'Home is on already')
  const part = findMenuPart(design, gates, ref)
  if (!part) {
    const names = menuParts(design, gates).map((each) => `${each.id} (${quoted(each.label)})`)
    return refuse(`The menu has no ${ref ?? 'item'}; it has ${listed(names)}`)
  }
  const id = part.id as MenuPartId
  switch (kind) {
    case 'rename': {
      const text = typeof value === 'string' ? value : ''
      return run(
        design,
        world,
        renameStep(design, gates, id, text),
        `${part.label} is already called that`
      )
    }
    case 'land':
      if (part.kind === 'link') return refuse('Visitors land on a page, not a link')
      return run(
        design,
        world,
        landingStep(design, gates, id as 'home' | PortalPageType),
        `Visitors land on ${part.label} already`
      )
    case 'first':
    case 'last': {
      if (part.kind === 'home') return refuse('Home always comes first')
      const count = menuParts(design, gates).filter((each) => each.kind !== 'home').length
      return run(
        design,
        world,
        menuPlaceStep(design, gates, id, kind === 'first' ? 0 : count - 1),
        `${part.label} is there already`
      )
    }
    default: {
      const why: Record<string, string> = {
        hide:
          part.lands && !design.nav.home.on
            ? `${part.label} is where visitors land, so it stays in the menu`
            : part.kind === 'link'
              ? 'A link is removed, not hidden'
              : `${part.label} is hidden already`,
        show: `${part.label} is shown already`,
        left: `${part.label} is first already`,
        right: `${part.label} is last already`,
        remove: 'Only a link is removed; a page is hidden',
      }
      return run(design, world, menuStep(design, gates, id, kind as MenuStepKind), why[kind]!)
    }
  }
}

function run(
  design: PortalDesign,
  world: OpWorld,
  step: MenuStep | null,
  refusal: string
): OpResult {
  if (!step) return refuse(refusal)
  const draft = structuredClone(design)
  step.change(draft)
  return finish(design, draft, step.label, world)
}

/* The page background */

const BACKGROUND_PAGE_WORDS: Record<string, BackgroundPage> = {
  home: 'home',
  feedback: 'feedback',
  roadmap: 'roadmap',
  changelog: 'changelog',
  'whats new': 'changelog',
  help: 'help',
  'help center': 'help',
  'help centre': 'help',
  support: 'support',
  status: 'status',
  post: 'post',
  posts: 'post',
}

/** Every page ("site") or the page a target names, as page backgrounds keep them. */
function backgroundTarget(target: string | undefined): BackgroundTarget | null {
  const word = norm((target ?? '').replace(/^page:/, ''))
    .replace(/ page$/, '')
    .replace(/^the /, '')
  if (['', 'site', 'every page', 'all pages', 'everywhere', 'portal', 'whole site'].includes(word))
    return 'site'
  return BACKGROUND_PAGE_WORDS[word] ?? null
}

/** A colour as a page background takes it: a role by another name, else as written. */
function backgroundColourWord(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const word = norm(value)
  if (['brand', 'brand colour', 'brand color', 'primary', 'accent'].includes(word)) return 'accent'
  if (['second', 'second colour', 'second color', 'support'].includes(word)) return 'support'
  if (['page', 'page colour', 'page color', 'background'].includes(word)) return 'page'
  return value
}

/** The settings each kind takes, beside its kind. */
const BACKGROUND_KEYS: Record<BackgroundKind, readonly string[]> = {
  solid: [],
  tint: ['colour', 'strength'],
  gradient: ['stops', 'shape', 'direction', 'centre', 'strength'],
  image: ['fit', 'position', 'strength', 'scroll'],
  pattern: ['pattern', 'colour', 'scale', 'strength'],
}

const KIND_WORDS = listed(['solid (the page colour)', 'tint', 'gradient', 'pattern', 'image'])
const PAGE_WORDS =
  'every page ("site"), or home, feedback, roadmap, changelog, help, support, status or post'

/** The settings written, read as a background takes them; a refusal for one it does not have. */
function backgroundSettings(
  kind: BackgroundKind,
  value: unknown
): { settings: Record<string, unknown> } | { refusal: string } {
  if (value === undefined || value === null || value === '') return { settings: {} }
  if (typeof value !== 'object' || Array.isArray(value))
    return {
      refusal: `A ${kind} background’s settings are written as JSON, such as {"strength":"soft"}`,
    }
  const settings: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'kind') continue
    if (key === 'image') return { refusal: 'I can’t add a picture myself' }
    const own = BACKGROUND_KEYS[kind]
    if (!own.includes(key))
      return {
        refusal: own.length
          ? `A ${kind} background has no ${key}; it takes ${listed([...own], 'and')}`
          : `The page colour has no settings; change it under Theme’s colours`,
      }
    const colours = key === 'colour' ? [raw] : key === 'stops' && Array.isArray(raw) ? raw : []
    const notColour = colours
      .map(backgroundColourWord)
      .find(
        (colour) =>
          typeof colour !== 'string' ||
          (!(DESIGN_OPTIONS.backgroundColour as readonly string[]).includes(colour) &&
            normaliseColor(colour) === null)
      )
    if (notColour !== undefined)
      return {
        refusal: `Page background: "${String(notColour)}" is not a colour; use a brand colour (accent, support) or an exact one such as #eef4ff`,
      }
    settings[key] =
      key === 'colour'
        ? backgroundColourWord(raw)
        : key === 'stops' && Array.isArray(raw)
          ? raw.map(backgroundColourWord)
          : key === 'strength' && kind === 'image' && typeof raw === 'string'
            ? Number(raw)
            : raw
  }
  return { settings }
}

/** finish, with a refusal said of the page background. */
function finishBackground(
  design: PortalDesign,
  draft: PortalDesign,
  label: string,
  world: OpWorld
): OpResult {
  const result = finish(design, draft, label, world)
  return result.ok ? result : refuse(`${label.split(':')[0]}: ${result.refusal}`)
}

/** In words, what a background now is, for its label. */
function backgroundWords(next: PageBackground | null): string {
  if (!next) return 'as every page'
  return BACKGROUND_NAMES[next.kind]
}

/**
 * Sets a page background: setBackground(target, kind | reset | dark, settings).
 * The same kind keeps the settings not written; an image is only ever one a
 * person uploaded, so the model changes how one sits and never adds one.
 */
export function setBackground(
  design: PortalDesign,
  world: OpWorld,
  target: string | undefined,
  key: string | undefined,
  value: unknown
): OpResult {
  const where = backgroundTarget(target)
  if (!where)
    return refuse(
      `A page background can be for ${PAGE_WORDS}; there is no ${target ?? 'such'} page`
    )
  const current = backgroundOf(design, where)
  const word = norm(key ?? '')
  const draft = structuredClone(design)
  if (word === 'reset' || word === 'follow' || word === 'auto') {
    if (where === 'site') return setBackground(design, world, target, 'solid', '')
    writeBackground(draft, where, null)
    return finishBackground(design, draft, backgroundLabel(where, 'as every page'), world)
  }
  if (word === 'dark') {
    const base = current ?? backgroundOf(design, 'site')!
    const { dark: _was, ...light } = base
    if (value === null || value === '' || value === 'auto') {
      writeBackground(draft, where, light as PageBackground)
      return finishBackground(design, draft, backgroundLabel(where, 'automatic in dark'), world)
    }
    if (typeof value !== 'object' || !('kind' in value))
      return refuse(
        'Dark mode’s own background is written with its kind, such as {"kind":"tint","colour":"accent"}'
      )
    const kind = (value as { kind: string }).kind as BackgroundKind
    if (!(DESIGN_OPTIONS.pageBackground as readonly string[]).includes(kind))
      return refuse(`A page background is ${KIND_WORDS}`)
    if (kind === 'image' && base.kind !== 'image')
      return refuse(
        'I can’t add a picture myself. Upload one in Theme, under Page background, and I can change how it shows.'
      )
    const read = backgroundSettings(kind, value)
    if ('refusal' in read) return refuse(read.refusal)
    const dark =
      kind === 'image' ? { ...light, ...read.settings } : withBackground(null, kind, read.settings)
    const parsed = backgroundFillSchema.safeParse(dark)
    if (!parsed.success)
      return refuse(
        `Dark mode’s background: ${parsed.error.issues[0]?.message ?? 'it is not one a page can have'}`
      )
    writeBackground(draft, where, { ...(light as PageBackground), dark: parsed.data })
    return finishBackground(
      design,
      draft,
      backgroundLabel(where, `${BACKGROUND_NAMES[kind]} in dark`),
      world
    )
  }
  const kind = (
    word === 'colour' || word === 'color' || word === 'soft colour'
      ? 'tint'
      : word === 'plain' || word === 'none' || word === 'page colour'
        ? 'solid'
        : word
  ) as BackgroundKind
  if (!(DESIGN_OPTIONS.pageBackground as readonly string[]).includes(kind))
    return refuse(`A page background is ${KIND_WORDS}; "${key ?? ''}" is none of them`)
  const read = backgroundSettings(kind, value)
  if ('refusal' in read)
    return refuse(
      read.refusal === 'I can’t add a picture myself'
        ? 'I can’t add a picture myself. Upload one in Theme, under Page background, and I can change how it shows.'
        : read.refusal
    )
  if (kind === 'image' && current?.kind !== 'image')
    return refuse(
      'I can’t add a picture myself. Upload one in Theme, under Page background, and I can change how it shows.'
    )
  const next = withBackground(current, kind, read.settings)
  writeBackground(draft, where, next)
  return finishBackground(design, draft, backgroundLabel(where, backgroundWords(next)), world)
}

/* Overrides: one part, one page, one block, phones */

/** Sets an element's look for one part, page or block, or everywhere: setOverride(target, key, value). */
export function setOverride(
  design: PortalDesign,
  world: OpWorld,
  target: string | undefined,
  key: string | undefined,
  value: unknown
): OpResult {
  const read = readOverrideOp(design, target, key, value)
  if (!read.ok) return refuse(read.refusal)
  const draft = structuredClone(design)
  if (!writeOverride(draft, read.read))
    return refuse(
      `${overrideLabel(read.read)}: there are already as many overrides as a design holds`
    )
  return finish(design, draft, overrideLabel(read.read), world)
}

/* One operation as written, and a list of them */

/** Applies one operation as the model writes it. */
export function applyOp(design: PortalDesign, world: OpWorld, op: FlatOp): OpResult {
  const value = readValue(op.value)
  switch (op.op) {
    case 'set': {
      // A part or a block named as an override names it (part:hero.home.cta, block.<id>.heading).
      const asOverride = setAsOverride(design, op)
      if (asOverride) return setOverride(design, world, asOverride.target, asOverride.key, value)
      const target = op.target ?? ''
      // A Theme setting, exact value or element style named with no block is the whole
      // portal's, as op theme writes it.
      if (!target.trim() && op.key && (themePath(themeKeyOf(op.key)) || tuneAsStyle(op.key)))
        return setTheme(design, world, op.key, value)
      // Phones' own sizes or dark mode's own colours: an override, of the block where one is named.
      if (
        /^(phone|phones|dark|stylePhone)\./i.test(op.key ?? '') ||
        /^overrides\./.test(op.key ?? '')
      ) {
        const block = findBlock(design, target)
        return setOverride(
          design,
          world,
          block.ok ? `block:${block.block.id}` : target,
          op.key,
          value
        )
      }
      // The hero's own fill, edge and shadow are its style, as op theme writes it.
      if (norm(target) === 'hero' && /^style(Dark)?\./.test(op.key ?? ''))
        return setTheme(design, world, op.key, value)
      if (norm(target) === 'hero') return setHero(design, world, op.key, value)
      const page = pageOf(target)
      if (page) {
        // "roadmap" names both a page and a Home block: a page's own setting, or a page said as one, is the page's.
        const said = /page\b|^page:/i.test(target) || SECTION_TYPES.includes(target as SectionType)
        const pageHas = pageSettings(page).includes(op.key ?? '')
        if (said || pageHas || !findBlock(design, target).ok)
          return setPageSection(design, world, page, op.key, value)
      }
      // A style aimed at an element rather than a block (target "body"): the whole portal's.
      if (/^style(Dark)?\./.test(op.key ?? '') && !findBlock(design, target).ok)
        return setTheme(design, world, op.key, value)
      return setBlockSetting(design, world, target, op.key, value)
    }
    case 'theme':
      // The builder's override and phone paths are overrides, whichever operation names them.
      if (/^(overrides|stylePhone)\./.test(op.key ?? ''))
        return setOverride(design, world, op.target, op.key, value)
      return setTheme(design, world, op.key ?? op.target, value)
    case 'words':
      return setWords(
        design,
        world,
        op.target,
        op.key,
        typeof value === 'string' || value === null ? value : op.value
      )
    case 'add':
      return addBlock(design, world, op.key, op.target, value)
    case 'move':
      return moveBlock(design, world, op.target, op.value ?? op.key)
    case 'resize':
      return resizeBlock(design, world, op.target, value ?? op.key)
    case 'remove':
      return removeBlock(design, world, op.target)
    case 'menu':
      return menuOp(design, world, op.target, op.key, value)
    case 'background':
      return setBackground(design, world, op.target, op.key, value)
    case 'override':
      return setOverride(design, world, op.target, op.key, value)
    default:
      return refuse(
        `There is no operation ${String((op as { op: unknown }).op)}; there are ${listed([...OP_KINDS])}`
      )
  }
}

/** Every field that differs between two designs, Home's blocks and the menu each taken whole. */
export function changedFields(before: unknown, after: unknown, at = ''): string[] {
  // Home's blocks, the menu and a page background each change as one.
  if (
    at === 'pages.home.blocks' ||
    at === 'nav' ||
    at === 'layout.background' ||
    at === 'layout.pageBackgrounds'
  )
    return stable(before) === stable(after) ? [] : [at]
  if (stable(before) === stable(after)) return []
  const isObject = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!isObject(before) || !isObject(after)) return [at]
  const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)])
  return [...keys].flatMap((key) =>
    changedFields(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
      at ? `${at}.${key}` : key
    )
  )
}

const read = (doc: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      doc
    )

const under = (path: string, field: string) => path === field || path.startsWith(`${field}.`)

/** The part of the portal a request is narrowed to: a scope, and the Home block picked. */
export interface OpScope {
  scope: DesignAiScope
  blockId?: string
  /** An element picked on the canvas: its kind, and the part it is (null for one of many). */
  element?: { element: StyleElement; part: string | null }
  /**
   * How far the request may reach from the pick, as the composer's chip says
   * it: just the part, the page shown, or everywhere the pick is (the default).
   */
  reach?: AiReach
  /** The page shown, which a reach of one page or one part keeps to. */
  page?: OverridePage
}

/** Whether an operation stays within what was picked, and as far as the request may reach. */
function opInScope(
  op: FlatOp,
  before: PortalDesign,
  after: PortalDesign,
  fields: readonly string[],
  within: OpScope
): boolean {
  if (within.scope === 'site') return true
  // An override is in scope by where it goes: the part, page or block picked.
  const named = setAsOverride(before, op)
  const override =
    op.op === 'override' || /^(overrides|stylePhone)\./.test(op.key ?? '')
      ? readOverrideOp(before, op.target, op.key, readValue(op.value))
      : named
        ? readOverrideOp(before, named.target, named.key, readValue(named.value))
        : null
  if (override?.ok)
    return overrideInScope(override.read, within) && overrideInReach(override.read, within)
  if (within.blockId) {
    if (!['set', 'move', 'resize', 'remove'].includes(op.op)) return false
    const found = findBlock(before, op.target)
    if (!found.ok || found.block.id !== within.blockId) return false
    // Naming the block is not enough: "roadmap" is a block and a page, and a
    // page's own setting lands on the page, outside what was picked.
    return fields.every(
      (field) => under(field, 'pages.home.blocks') || pathInScope(field, within.scope)
    )
  }
  if (!fields.every((field) => pathInScope(field, within.scope))) return false
  return fieldsInReach(before, after, fields, within)
}

/**
 * Whether changed fields stay as near as the request may reach: anywhere
 * for every page; for one page or one part, only fields drawn on the page
 * shown, never one every page shares.
 */
function fieldsInReach(
  before: PortalDesign,
  after: PortalDesign,
  fields: readonly string[],
  within: OpScope
): boolean {
  if (!within.reach || within.reach === 'every') return true
  const page = within.page
  if (!page) return false
  return fields.every((path) => {
    const pages = changePages(after, { path, before: read(before, path), after: read(after, path) })
    return pages !== 'every' && [...pages].every((each) => each === page)
  })
}

export interface OpsOutcome {
  design: PortalDesign
  /** Each field changed, once, from its value before the first operation that changed it, with its operations' labels. */
  applied: AppliedDesignChange[]
  /** The operations that changed the design, with their labels. */
  done: Array<{ op: FlatOp; label: string }>
  /** Operations that asked for what the design already has. */
  already: Array<{ op: FlatOp; label: string }>
  refused: Array<{ op: FlatOp; reason: string }>
  /** Operations about something other than what was picked, left alone. */
  outOfScope: FlatOp[]
}

/**
 * Applies operations in order, each on the design the ones before it left.
 * A refused one leaves the rest; each field changed is one undoable change.
 */
export function applyOps(
  design: PortalDesign,
  world: OpWorld,
  ops: readonly FlatOp[],
  within: OpScope = { scope: 'site' }
): OpsOutcome {
  let current = design
  const snapshots: PortalDesign[] = []
  const touched = new Map<string, { first: number; labels: string[] }>()
  const outcome: OpsOutcome = {
    design,
    applied: [],
    done: [],
    already: [],
    refused: [],
    outOfScope: [],
  }
  for (const op of ops) {
    const result = applyOp(current, world, op)
    if (!result.ok) {
      outcome.refused.push({ op, reason: result.refusal })
      continue
    }
    if (!result.changed) {
      outcome.already.push({ op, label: result.label })
      continue
    }
    const fields = changedFields(current, result.design)
    if (!opInScope(op, current, result.design, fields, within)) {
      outcome.outOfScope.push(op)
      continue
    }
    snapshots.push(current)
    for (const field of fields) {
      const ancestor = [...touched.keys()].find((path) => under(field, path))
      if (ancestor) {
        const entry = touched.get(ancestor)!
        if (!entry.labels.includes(result.label)) entry.labels.push(result.label)
        continue
      }
      const descendants = [...touched.entries()].filter(([path]) => under(path, field))
      const first = Math.min(snapshots.length - 1, ...descendants.map(([, entry]) => entry.first))
      const labels = [
        ...new Set([...descendants.flatMap(([, entry]) => entry.labels), result.label]),
      ]
      for (const [path] of descendants) touched.delete(path)
      touched.set(field, { first, labels })
    }
    outcome.done.push({ op, label: result.label })
    current = result.design
  }
  outcome.design = current
  outcome.applied = [...touched.entries()].map(([path, { first, labels }]) => ({
    path,
    before: structuredClone(read(snapshots[first], path) ?? null) as DesignValue,
    after: structuredClone(read(current, path) ?? null) as DesignValue,
    label: labels.join('; '),
  }))
  return outcome
}

/** Home's blocks in reading order: top to bottom, left to right. */
export function blocksInOrder(design: PortalDesign): HomeBlock[] {
  const byId = new Map(design.pages.home.blocks.map((block, i) => [block.id ?? `#${i}`, block]))
  return readingOrder(gridItemsOf(design.pages.home.blocks)).map((item) => byId.get(item.id)!)
}
