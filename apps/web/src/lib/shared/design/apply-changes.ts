/**
 * Quackback AI's one tool on a portal design: set any field of the design
 * document, by its path, to a new value. Each change is applied on its own
 * and kept only when the design still passes the schema and the contrast
 * solver, so a bad suggestion drops out, with its reason, without taking the
 * good ones with it.
 *
 * A few shorthands let a value be written as a person says it: plain text
 * for rich text and for the English of a translated field, a font id for a
 * bundled font, any colour CSS reads, and a Home block by its type and width
 * alone. Output from the model is untrusted, so it also may not bring in a
 * stored file or a link the person did not give, a Home block for a page
 * that is off, or CSS the CSS check refuses.
 */
import { normaliseColor } from './color'
import { newBlock, type HomeBlockType } from './home'
import { BUNDLED_FONT_IDS } from './options'
import { resolveDesign } from './resolve'
import { portalDesign, type PortalDesign } from './schema'

/** The part of the portal a request is about; a section scope reaches only its own fields. */
export const DESIGN_AI_SCOPES = [
  'site',
  'brand',
  'header',
  'band',
  'welcome',
  'feed',
  'filters',
  'home',
] as const
export type DesignAiScope = (typeof DESIGN_AI_SCOPES)[number]

const SCOPE_FIELDS: Record<Exclude<DesignAiScope, 'site'>, readonly string[]> = {
  brand: ['mode', 'brand', 'shape', 'vocabulary'],
  header: ['layout.header', 'layout.nav', 'nav', 'brand.logo.display'],
  band: ['layout.band', 'pages.feedback.headline'],
  welcome: ['pages.feedback.welcome'],
  feed: [
    'layout.cards',
    'layout.density',
    'layout.width',
    'pages.feedback.defaultSort',
    'pages.feedback.copy',
  ],
  filters: ['layout.filters'],
  home: ['pages.home', 'nav.home'],
}

const within = (path: string, field: string) => path === field || path.startsWith(`${field}.`)

/** The fields a request about one part of the portal may change, each with everything under it. */
export function scopeFields(scope: Exclude<DesignAiScope, 'site'>): readonly string[] {
  return SCOPE_FIELDS[scope]
}

const inScope = (path: string, scope: DesignAiScope) =>
  scope === 'site' || SCOPE_FIELDS[scope].some((field) => within(path, field))

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
}

/** Checks on changes that came from the model rather than from a person. */
export interface UntrustedChanges {
  /** Home block types whose pages are on. */
  blockTypes: readonly HomeBlockType[]
  /** Links the person gave; the model may add no other. */
  links: ReadonlySet<string>
  /** Why the CSS cannot be saved, or null when it can. */
  checkCss: (css: string) => string | null
}

/** The language a translated field's plain-text shorthand writes. */
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

/** Writes a value at a path whose parent exists; undefined removes the field. */
function writeAt(root: unknown, keys: string[], value: unknown): boolean {
  const last = keys[keys.length - 1]!
  let parent = root
  for (const key of keys.slice(0, -1)) {
    parent = (parent as Record<string, unknown> | null)?.[key]
    if (parent === null || typeof parent !== 'object') return false
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

/** A Home block as written, filled in with its type's defaults and an allowed width. */
function homeBlock(value: unknown): unknown {
  if (!isRecord(value) || typeof value.type !== 'string') return value
  const base = newBlock(value.type as HomeBlockType, value.width as never) as Record<
    string,
    unknown
  >
  const block: Record<string, unknown> = { ...base, ...value, width: base.width }
  if (typeof block.body === 'string') block.body = textDoc(block.body)
  return block
}

/** The value as the document holds it, from the shorthand a person or the model wrote. */
function shaped(doc: PortalDesign, path: string, value: unknown): unknown {
  const current = read(doc, path)
  if (/^brand\.fonts\.(heading|body)$/.test(path) && typeof value === 'string') {
    return (BUNDLED_FONT_IDS as readonly string[]).includes(value)
      ? { kind: 'bundled', id: value }
      : value
  }
  if (/^brand\.(light|dark)\.\w+$/.test(path)) {
    if (value === null) return undefined
    return typeof value === 'string' ? (normaliseColor(value) ?? value) : value
  }
  if (typeof value === 'string' && isRichText(current)) return textDoc(value)
  if (typeof value === 'string' && isLocalized(current)) {
    const localized = { ...(current as Record<string, string>) }
    if (value.trim()) localized[ENGLISH] = value.trim()
    else delete localized[ENGLISH]
    return Object.keys(localized).length || !path.startsWith('pages.feedback.copy.')
      ? localized
      : undefined
  }
  if (path === 'pages.home.blocks' && Array.isArray(value)) return value.map(homeBlock)
  if (/^pages\.home\.blocks\.\d+$/.test(path)) return homeBlock(value)
  if (path === 'pages.feedback.welcome' && isRecord(value) && typeof value.body === 'string')
    return { ...value, body: textDoc(value.body) }
  return value
}

/** The design with one change written in, or the reason it cannot be. */
function write(doc: PortalDesign, path: string, value: unknown): PortalDesign | string {
  const keys = keysOf(path)
  if (!keys) return 'there is no such field'
  const next = structuredClone(doc) as PortalDesign
  // A headline can be written a line at a time, even when there is none yet.
  const page = /^pages\.(home|feedback)\.headline\./.exec(path)?.[1] as
    'home' | 'feedback' | undefined
  if (page && !next.pages[page].headline) next.pages[page].headline = { title: {}, subtitle: {} }
  if (!writeAt(next, keys, shaped(next, path, value))) return 'there is no such field'
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
  if ([...valuesNamed('key', after)].some((key) => !files.has(key)))
    return 'images and fonts are uploaded in Brand'
  const had = valuesNamed('url', before)
  const link = [...valuesNamed('url', after)].find((url) => !had.has(url) && !checks.links.has(url))
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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function applyDesignChanges(
  doc: PortalDesign,
  changes: DesignChangeRequest[],
  scope: DesignAiScope,
  /** Present when the changes came from the model. */
  untrusted?: UntrustedChanges
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
  for (const { path, value } of changes) {
    if (!inScope(path, scope)) {
      outOfScope.push(path)
      continue
    }
    // An optional field is cleared by leaving it out; a nullable one takes null.
    const attempts = value === null ? [null, undefined] : [value]
    let next: PortalDesign | null = null
    let reason = 'the design does not allow it'
    for (const attempt of attempts) {
      const written = write(design, path, attempt)
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
