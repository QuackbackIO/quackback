/**
 * Quackback AI's one tool on a portal design: set any field of the design
 * document, by its path, to a new value. Each change is applied on its own
 * and kept only when the design still passes the schema and the contrast
 * solver, so a bad suggestion drops out, with its reason, without taking the
 * good ones with it.
 *
 * A few shorthands let a value be written as a person says it: plain text
 * for rich text and for the English of a translated field, a font id for a
 * bundled font, any colour CSS reads, and a Home block by its type and place
 * alone (or the width it once had), laid out on Home's grid with the rest. Output from the model is untrusted, so it also may not bring in a
 * stored file or a link the person did not give, a Home block for a page
 * that is off, or CSS the CSS check refuses.
 */
import { normaliseColor } from './color'
import { newBlock, settleHome, type HomeBlockType } from './home'
import { LEGACY_WIDTH_COLUMNS, withGridPlaces } from './home-legacy'
import { BUNDLED_FONT_IDS } from './options'
import { resolveDesign } from './resolve'
import { portalDesign, type PortalDesign } from './schema'
import type { StyleElement } from './style-tokens'

/**
 * The part of the portal a request is about: a section, or an element such as
 * the buttons wherever they appear. A scope reaches only its own fields, each
 * with its exact values and fonts, so a request about the headline can make
 * it lighter.
 */
export const DESIGN_AI_SCOPES = [
  'site',
  'brand',
  'header',
  'band',
  'welcome',
  'feed',
  'filters',
  'home',
  'headline',
  'subtitle',
  'heading',
  'menu',
  'button',
  'card',
  'vote',
  'field',
  'logo',
  'status',
  'link',
  'secondary',
  'body',
  'roadmap',
  'changelog',
  'help',
  'post',
] as const
export type DesignAiScope = (typeof DESIGN_AI_SCOPES)[number]

/** An element picked on the canvas, as Ask AI is told it: its kind and the part it is. */
export interface AiElementPick {
  element: StyleElement
  /** The registered part it is, or null for one of many alike. */
  part: string | null
}

const HEADLINE_TYPE = [
  'tune.headline',
  'style.headline',
  'styleDark.headline',
  'brand.fonts.display',
  'brand.fonts.headlineColour',
  'brand.fonts.scale',
  'brand.fonts.tracking',
  'brand.fonts.headlineCase',
]

const SCOPE_FIELDS: Record<Exclude<DesignAiScope, 'site'>, readonly string[]> = {
  // Site styles: everything about how the portal looks, not what it says.
  brand: ['mode', 'brand', 'shape', 'tune', 'layout', 'style', 'styleDark'],
  header: [
    'layout.header',
    'layout.nav',
    'layout.headerOnBand',
    'nav',
    'brand.logo',
    'tune.label',
    'brand.fonts.labelCase',
    'layout.navText',
    'style.header',
    'styleDark.header',
    'style.navItem',
    'styleDark.navItem',
  ],
  band: [
    'style.hero',
    'styleDark.hero',
    'layout.band',
    'layout.bandColour',
    'layout.blend',
    'layout.bandAlign',
    'layout.bandShape',
    'layout.bandHeight',
    'layout.fadeFrom',
    'layout.bandGlow',
    'layout.bandGlowColour',
    'layout.bandArt',
    'layout.imagePlace',
    'layout.imageFocus',
    'layout.imagePoint',
    'layout.imagePhone',
    'brand.bandImage',
    'layout.headerOnBand',
    'pages.home.composer',
    'pages.home.composerWidth',
    'pages.home.mainAction',
    'pages.home.button',
    'shape.action',
    'pages.feedback.headline',
    'pages.home.headline',
    'layout.pageTitles',
    'pages.titles',
    'tune.subtitle',
    // What sits with a page's title: the changelog's Subscribe, the help center's search.
    'pages.changelog.subscribe',
    'pages.help.search',
    ...HEADLINE_TYPE,
  ],
  welcome: ['pages.feedback.welcome'],
  feed: [
    'layout.cards',
    'layout.density',
    'layout.width',
    'layout.postCardHides',
    'pages.feedback.defaultSort',
    'pages.feedback.openOn',
    'pages.feedback.copy',
    'layout.status',
    'tune.card',
    'style.tab',
    'styleDark.tab',
  ],
  filters: ['layout.filters', 'style.tab', 'styleDark.tab'],
  home: ['pages.home', 'nav.home', 'tune.heading'],
  headline: HEADLINE_TYPE,
  subtitle: ['tune.subtitle', 'style.subtitle', 'styleDark.subtitle'],
  heading: [
    'tune.heading',
    'brand.fonts.heading',
    'brand.fonts.headingWeight',
    'style.heading',
    'styleDark.heading',
  ],
  menu: [
    'layout.nav',
    'layout.navText',
    'tune.label',
    'brand.fonts.labelCase',
    'style.navItem',
    'styleDark.navItem',
  ],
  button: [
    'tune.button',
    'tune.label',
    'style.button',
    'styleDark.button',
    'shape.buttons',
    'shape.fill',
    'shape.action',
    'brand.fonts.labelCase',
  ],
  card: [
    'layout.cards',
    'layout.density',
    'layout.postCardHides',
    'tune.card',
    'shape.corners',
    'style.postCard',
    'styleDark.postCard',
    'style.panel',
    'styleDark.panel',
  ],
  vote: [
    'layout.tint',
    'shape.corners',
    'brand.light.support',
    'brand.dark.support',
    'style.vote',
    'styleDark.vote',
  ],
  field: ['tune.field', 'shape.corners', 'style.input', 'styleDark.input'],
  logo: ['brand.logo', 'brand.logoColours', 'brand.favicon'],
  status: ['layout.status', 'brand.logoColours', 'style.badge', 'styleDark.badge'],
  link: ['tune.link', 'style.link', 'styleDark.link'],
  secondary: [
    'tune.secondary',
    'style.secondary',
    'styleDark.secondary',
    'style.ghost',
    'styleDark.ghost',
  ],
  body: ['tune.body', 'style.body', 'styleDark.body'],
  roadmap: ['pages.roadmap', 'pages.titles.roadmap'],
  changelog: ['pages.changelog', 'pages.titles.changelog'],
  help: ['pages.help', 'pages.titles.help'],
  post: ['pages.post'],
}

const within = (path: string, field: string) => path === field || path.startsWith(`${field}.`)

/** The fields a request about one part of the portal may change, each with everything under it. */
export function scopeFields(scope: Exclude<DesignAiScope, 'site'>): readonly string[] {
  return SCOPE_FIELDS[scope]
}

const inScope = (path: string, scope: DesignAiScope) =>
  scope === 'site' || SCOPE_FIELDS[scope].some((field) => within(path, field))

/** Whether a field is one a request about this part may change, and within `only` when given. */
export function pathInScope(path: string, scope: DesignAiScope, only?: readonly string[]): boolean {
  return inScope(path, scope) && (!only || only.some((field) => within(path, field)))
}

/** A value in the design document; null where a field is absent. */
export type DesignValue =
  string | number | boolean | null | DesignValue[] | { [key: string]: DesignValue }

export interface DesignChangeRequest {
  path: string
  value: unknown
}

export interface AppliedDesignChange {
  path: string
  before: DesignValue
  after: DesignValue
  /** The evidence a change came from, where it was measured or decided from screenshots. */
  why?: string
  /** What the change did, as its undo names it, such as "Move Help search to the top". */
  label?: string
}

/** Checks on changes that came from the model rather than from a person. */
export interface UntrustedChanges {
  /** Home block types whose pages are on. */
  blockTypes: readonly HomeBlockType[]
  /** Links the person gave; the model may add no other. */
  links: ReadonlySet<string>
  /** Why the CSS cannot be saved, or null when it can. */
  checkCss: (css: string) => string | null
  /** Files stored for this request, such as a website's wordmark, which the model may place. */
  files?: ReadonlySet<string>
  /** The language plain text writes in a field by language: the one the person sees. English when not given. */
  language?: string
}

/** The language a translated field's plain-text shorthand writes when none is given. */
const ENGLISH = 'en'

/** A rich-text document's text, one paragraph per blank-line-separated block. */
export function docText(doc: unknown): string {
  const blocks = (doc as { content?: Array<{ content?: Array<{ text?: string }> }> })?.content
  return (blocks ?? [])
    .map((block) => (block.content ?? []).map((node) => node.text ?? '').join(''))
    .filter(Boolean)
    .join('\n\n')
}

/** Plain text as a rich-text document, a paragraph for each block. */
function textDoc(text: string) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
  return {
    type: 'doc',
    content: paragraphs.length
      ? paragraphs.map((part) => ({ type: 'paragraph', content: [{ type: 'text', text: part }] }))
      : [{ type: 'paragraph' }],
  }
}

/** The welcome message as plain text, as Quackback AI reads and writes it. */
export function welcomeText(doc: PortalDesign): string {
  return docText(doc.pages.feedback.welcome.body)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isRichText = (value: unknown) => isRecord(value) && value.type === 'doc'
const isLocalized = (value: unknown) =>
  isRecord(value) && Object.keys(value).every((key) => /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(key))
const SAFE_KEY = /^[A-Za-z0-9_]+$/
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function keysOf(path: string): string[] | null {
  const keys = path.split('.')
  return keys.every((key) => SAFE_KEY.test(key) && !UNSAFE_KEYS.has(key)) ? keys : null
}

function read(doc: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value === null || typeof value !== 'object'
          ? undefined
          : (value as Record<string, unknown>)[key],
      doc
    )
}

/**
 * Writes a value at a path; undefined removes the field. A missing part of
 * the path is made as an object, such as the dark colours before any is
 * set, and the schema decides whether it belongs.
 */
function writeAt(root: unknown, keys: string[], value: unknown): boolean {
  const last = keys[keys.length - 1]!
  let parent = root as Record<string, unknown>
  for (const key of keys.slice(0, -1)) {
    if (parent[key] === undefined && !Array.isArray(parent)) parent[key] = {}
    const next = parent[key]
    if (next === null || typeof next !== 'object') return false
    parent = next as Record<string, unknown>
  }
  if (Array.isArray(parent)) {
    const index = Number(last)
    if (!Number.isInteger(index) || index < 0 || index > parent.length) return false
    if (value === undefined) parent.splice(index, 1)
    else parent[index] = value
    return true
  }
  const object = parent as Record<string, unknown>
  if (value === undefined) delete object[last]
  else object[last] = value
  return true
}

/**
 * A Home block as written, filled in with its type's defaults. Its place is
 * the one written, else the one of the block it replaces; a block with none
 * is packed under the rest in order, at its usual size or the share of
 * twelve columns a width from before the grid gives it.
 */
function homeBlock(value: unknown, current: unknown): unknown {
  if (!isRecord(value) || typeof value.type !== 'string') return value
  const { grid: usual, ...base } = newBlock(value.type as HomeBlockType) as Record<string, unknown>
  // A block written over one already there keeps its id and place, so its selection and authors follow it.
  const kept = isRecord(current) ? current : {}
  const id = typeof kept.id === 'string' ? { id: kept.id } : {}
  const { width, grid: written, ...rest } = value
  const columns = typeof width === 'string' ? LEGACY_WIDTH_COLUMNS[width] : undefined
  const block: Record<string, unknown> = { ...base, ...rest, ...id }
  if (isRecord(written))
    block.grid = { ...(usual as object), ...(isRecord(kept.grid) ? kept.grid : {}), ...written }
  else if (isRecord(kept.grid)) block.grid = { ...kept.grid, ...(columns ? { w: columns } : {}) }
  else if (width !== undefined) block.width = width
  if (typeof block.body === 'string') block.body = textDoc(block.body)
  return block
}

const isPlace = (value: unknown) =>
  isRecord(value) && ['x', 'y', 'w', 'h'].every((key) => Number.isInteger(value[key]))

/** The value as the document holds it, from the shorthand a person or the model wrote. */
function shaped(doc: PortalDesign, path: string, value: unknown, language: string): unknown {
  const current = read(doc, path)
  if (path === 'brand.fonts.display' && value === null) return undefined
  if (/^brand\.fonts\.(heading|body|display)$/.test(path) && typeof value === 'string') {
    return (BUNDLED_FONT_IDS as readonly string[]).includes(value)
      ? { kind: 'bundled', id: value }
      : value
  }
  if (/^brand\.(light|dark)\.\w+$/.test(path)) {
    if (value === null) return undefined
    return typeof value === 'string' ? (normaliseColor(value) ?? value) : value
  }
  if (typeof value === 'string' && isRichText(current)) return textDoc(value)
  const translated =
    /^pages\.(feedback\.copy\.(prompt|submit|emptyTitle)|(home|feedback)\.headline\.(title|subtitle)|titles\.(roadmap|changelog|help|support)\.(title|subtitle))$/.test(
      path
    )
  if (
    typeof value === 'string' &&
    (isLocalized(current) || (translated && current === undefined))
  ) {
    const localized = { ...((current ?? {}) as Record<string, string>) }
    if (value.trim()) localized[language] = value.trim()
    else delete localized[language]
    return Object.keys(localized).length || !path.startsWith('pages.feedback.copy.')
      ? localized
      : undefined
  }
  if (path === 'pages.home.blocks' && Array.isArray(value)) return value.map(homeBlock)
  if (/^pages\.home\.blocks\.\d+$/.test(path)) return homeBlock(value, current)
  if (path === 'pages.feedback.welcome' && isRecord(value) && typeof value.body === 'string')
    return { ...value, body: textDoc(value.body) }
  return value
}

/** The design with one change written in, or the reason it cannot be. */
function write(
  doc: PortalDesign,
  path: string,
  value: unknown,
  language = ENGLISH
): PortalDesign | string {
  const keys = keysOf(path)
  if (!keys) return 'there is no such field'
  const next = structuredClone(doc) as PortalDesign
  // A headline can be written a line at a time, even when there is none yet.
  const page = /^pages\.(home|feedback)\.headline\./.exec(path)?.[1] as
    'home' | 'feedback' | undefined
  if (page && !next.pages[page].headline) next.pages[page].headline = { title: {}, subtitle: {} }
  // So can a page's own title.
  const titled = /^pages\.titles\.(roadmap|changelog|help|support)\./.exec(path)?.[1] as
    'roadmap' | 'changelog' | 'help' | 'support' | undefined
  if (titled) {
    next.pages.titles ??= {}
    next.pages.titles[titled] ??= { title: {}, subtitle: {} }
  }
  if (!writeAt(next, keys, shaped(next, path, value, language))) return 'there is no such field'
  // Home's blocks are laid out again: placed, in the grid, at least their sizes, none overlapping.
  if (path.startsWith('pages.home.blocks')) {
    next.pages.home = withGridPlaces(next.pages.home) as PortalDesign['pages']['home']
    if (next.pages.home.blocks.every((block) => isPlace(block.grid))) settleHome(next)
  }
  if (titled && next.pages.titles) {
    const words = next.pages.titles[titled]
    if (words && !Object.keys(words.title).length && !Object.keys(words.subtitle).length)
      delete next.pages.titles[titled]
    if (!Object.keys(next.pages.titles).length) delete next.pages.titles
  }
  if (page) {
    const line = next.pages[page].headline
    if (line && !Object.keys(line.title).length && !Object.keys(line.subtitle).length)
      next.pages[page].headline = null
  }
  return next
}

/** Every value a design holds under a field of this name. */
function valuesNamed(name: string, doc: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(doc)) doc.forEach((item) => valuesNamed(name, item, found))
  else if (isRecord(doc))
    for (const [key, value] of Object.entries(doc)) {
      if (key === name && typeof value === 'string') found.add(value)
      else valuesNamed(name, value, found)
    }
  return found
}

/** Why the model may not make this change, or null. */
function untrustedRefusal(
  before: PortalDesign,
  after: PortalDesign,
  checks: UntrustedChanges
): string | null {
  const files = valuesNamed('key', before)
  if ([...valuesNamed('key', after)].some((key) => !files.has(key) && !checks.files?.has(key)))
    return 'images and fonts are uploaded in Brand'
  // Links are a links block's urls and the links in rich words (a mark's href).
  const linksOf = (doc: PortalDesign) =>
    new Set([...valuesNamed('url', doc), ...valuesNamed('href', doc)])
  const had = linksOf(before)
  const link = [...linksOf(after)].find((url) => !had.has(url) && !checks.links.has(url))
  if (link) return `${link} is not a link you gave`
  const types = new Set(before.pages.home.blocks.map((block) => block.type))
  const off = after.pages.home.blocks.find(
    (block) => !types.has(block.type) && !checks.blockTypes.includes(block.type)
  )
  if (off) return `the ${off.type.replace('_', ' ')} block needs its page on`
  if (after.css && after.css !== (before.css ?? '')) return checks.checkCss(after.css)
  return null
}

/** Why a design cannot be saved, in a person's words, or null when it can. */
function invalid(doc: PortalDesign): string | null {
  const parsed = portalDesign.safeParse(doc)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'invalid_value') return `it takes ${issue.values.join(', ')}`
    return issue?.message ?? 'the design does not allow it'
  }
  return resolveDesign(parsed.data).errors.length ? 'the text would not be readable' : null
}

/**
 * Why a design changed from `before` to `after` cannot be kept, in a
 * person's words, or null when it can: the schema, the contrast solver and,
 * for changes from the model, the files, links, blocks and CSS it may bring.
 */
export function designRefusal(
  before: PortalDesign,
  after: PortalDesign,
  untrusted?: UntrustedChanges
): string | null {
  return invalid(after) ?? (untrusted ? untrustedRefusal(before, after, untrusted) : null)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Whether the draft still holds a change: applied, undone (back to its
 * before-value), or changed since to something else.
 */
export function changeState(
  doc: PortalDesign,
  change: Pick<AppliedDesignChange, 'path' | 'before' | 'after'>
): 'applied' | 'undone' | 'changed' {
  // Keys in any order: a saved draft holds its objects in the schema's order.
  const key = (value: unknown): string =>
    JSON.stringify(value ?? null, (_, v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
        : v
    )
  const now = key(read(doc, change.path))
  if (now === key(change.after)) return 'applied'
  return now === key(change.before) ? 'undone' : 'changed'
}

export function applyDesignChanges(
  doc: PortalDesign,
  changes: DesignChangeRequest[],
  scope: DesignAiScope,
  /** Present when the changes came from the model. */
  untrusted?: UntrustedChanges,
  /** Narrows the scope further, to these fields and what is under them, such as one block. */
  only?: readonly string[]
): {
  design: PortalDesign
  applied: AppliedDesignChange[]
  skipped: number
  /** Changes left alone because they are outside the section picked. */
  outOfScope: string[]
  /** Changes left alone for their value, each with why. */
  refused: Array<{ path: string; reason: string }>
} {
  let design = doc
  const applied: AppliedDesignChange[] = []
  const outOfScope: string[] = []
  const refused: Array<{ path: string; reason: string }> = []
  for (const change of changes) {
    const { path } = change
    let { value } = change
    if (!inScope(path, scope) || (only && !only.some((field) => within(path, field)))) {
      outOfScope.push(path)
      continue
    }
    // Home blocks for pages that are off are left out; the rest of the layout stands.
    if (untrusted && path === 'pages.home.blocks' && Array.isArray(value)) {
      const had = new Set(design.pages.home.blocks.map((block) => block.type))
      const off = value.filter(
        (block) =>
          isRecord(block) &&
          !had.has(block.type as HomeBlockType) &&
          !untrusted.blockTypes.includes(block.type as HomeBlockType)
      )
      for (const block of off)
        refused.push({
          path,
          reason: `the ${String(block.type).replace('_', ' ')} block needs its page on`,
        })
      value = value.filter((block) => !off.includes(block))
    }
    // An optional field is cleared by leaving it out; a nullable one takes null.
    const attempts = value === null ? [null, undefined] : [value]
    let next: PortalDesign | null = null
    let reason = 'the design does not allow it'
    for (const attempt of attempts) {
      const written = write(design, path, attempt, untrusted?.language)
      const why =
        typeof written === 'string'
          ? written
          : (invalid(written) ?? (untrusted ? untrustedRefusal(design, written, untrusted) : null))
      if (why === null && typeof written !== 'string') {
        next = written
        break
      }
      reason = why ?? reason
    }
    if (!next) {
      refused.push({ path, reason })
      continue
    }
    const before = read(design, path)
    const after = read(next, path)
    if (same(before, after)) continue
    applied.push({
      path,
      before: structuredClone(before ?? null) as DesignValue,
      after: structuredClone(after ?? null) as DesignValue,
    })
    design = portalDesign.parse(next)
  }
  return { design, applied, skipped: refused.length + outOfScope.length, outOfScope, refused }
}
