/**
 * Reading a design that is already stored. A newer build may have saved
 * fields or option values this build does not know; after a rollback, those
 * designs still render with everything this build understands, rather than
 * falling back to the plain portal. Writes stay strict: this is for reads,
 * except for the keys designs no longer have, which no document keeps.
 */
import { defaultDesign, portalDesign, type PortalDesign } from './schema'

type Path = ReadonlyArray<PropertyKey>

/** Optional fields of a list item that can go without losing the item. */
const OPTIONAL_ITEM_FIELDS = new Set(['look', 'heading', 'label'])

/** At most this many repairs, so a document that is not a design ends quickly. */
const MAX_REPAIRS = 40

/** Keys a design once had: the words for posts and boards, now fixed, and footer links. */
const RETIRED_KEYS = ['vocabulary', 'footer']
/** The logo's name styles, gone since the logo became an icon and a title. */
const RETIRED_LOGO_KEYS = ['nameColour', 'nameCase', 'nameAccent']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A focus ring's colour, gone since focus rings stay neutral grey; its width stays. */
const RETIRED_STYLE_PROP = 'ring'

/** Whether a style sheet ({ element: { state: props } }) still names a ring colour. */
const sheetHasRing = (sheet: unknown): boolean =>
  isRecord(sheet) &&
  Object.values(sheet).some(
    (states) =>
      isRecord(states) &&
      Object.values(states).some(
        (props) => isRecord(props) && Object.hasOwn(props, RETIRED_STYLE_PROP)
      )
  )

/** A style sheet without ring colours, dropping a state or element left empty; the one given stays. */
function sheetWithoutRing(sheet: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [element, states] of Object.entries(sheet)) {
    if (!isRecord(states)) {
      out[element] = states
      continue
    }
    const kept: Record<string, unknown> = {}
    for (const [state, props] of Object.entries(states)) {
      if (!isRecord(props) || !Object.hasOwn(props, RETIRED_STYLE_PROP)) {
        kept[state] = props
        continue
      }
      const { [RETIRED_STYLE_PROP]: _ring, ...rest } = props
      if (Object.keys(rest).length) kept[state] = rest
    }
    if (Object.keys(kept).length) out[element] = kept
  }
  return Object.keys(out).length ? out : undefined
}

/** Replaces each of a record's sheets that names a ring colour, deleting one left empty. */
function stripRings(holder: Record<string, unknown>, keys: readonly string[]): boolean {
  let changed = false
  for (const key of keys) {
    const sheet = holder[key]
    if (!sheetHasRing(sheet)) continue
    const next = sheetWithoutRing(sheet as Record<string, unknown>)
    if (next) holder[key] = next
    else delete holder[key]
    changed = true
  }
  return changed
}

/** An override's looks, each one element's states. */
const OVERRIDE_LAYERS = ['style', 'styleDark', 'phone'] as const

/**
 * A design without focus ring colours, in its site, block and override looks.
 * A copy where one is found; the document given otherwise.
 */
function withoutRingColours(doc: Record<string, unknown>): Record<string, unknown> {
  const has =
    sheetHasRing(doc.style) ||
    sheetHasRing(doc.styleDark) ||
    (Array.isArray(doc.overrides) &&
      doc.overrides.some(
        (o) => isRecord(o) && OVERRIDE_LAYERS.some((layer) => sheetHasRing({ one: o[layer] }))
      )) ||
    (isRecord(doc.pages) &&
      isRecord(doc.pages.home) &&
      Array.isArray(doc.pages.home.blocks) &&
      doc.pages.home.blocks.some(
        (b) => isRecord(b) && isRecord(b.look) && sheetHasRing(b.look.style)
      ))
  if (!has) return doc
  const out = structuredClone(doc)
  stripRings(out, ['style', 'styleDark'])
  if (Array.isArray(out.overrides)) {
    for (const o of out.overrides) {
      if (!isRecord(o)) continue
      for (const layer of OVERRIDE_LAYERS) {
        // An override's look is one element's states: as a sheet of one.
        if (!sheetHasRing({ one: o[layer] })) continue
        const states = sheetWithoutRing({ one: o[layer] })?.one
        if (states) o[layer] = states
        else delete o[layer]
      }
    }
    // An override left with no look at all goes with it.
    out.overrides = out.overrides.filter(
      (o) => !isRecord(o) || OVERRIDE_LAYERS.some((layer) => o[layer] !== undefined)
    )
    if (!(out.overrides as unknown[]).length) delete out.overrides
  }
  const blocks = isRecord(out.pages) && isRecord(out.pages.home) ? out.pages.home.blocks : null
  if (Array.isArray(blocks))
    for (const b of blocks) {
      if (!isRecord(b) || !isRecord(b.look)) continue
      stripRings(b.look, ['style'])
      if (!Object.keys(b.look).length) delete b.look
    }
  return out
}

/**
 * A design document without the keys designs no longer have, so one stored,
 * sent or written before they went still reads. The document given stays as it is.
 */
export function withoutRetiredKeys(given: unknown): unknown {
  if (!isRecord(given)) return given
  const input = withoutRingColours(given)
  const brand = input.brand
  const logo = isRecord(brand) ? brand.logo : undefined
  const retiredLogo = isRecord(logo) && RETIRED_LOGO_KEYS.some((key) => Object.hasOwn(logo, key))
  if (!RETIRED_KEYS.some((key) => Object.hasOwn(input, key)) && !retiredLogo) return input
  const doc = { ...input }
  for (const key of RETIRED_KEYS) delete doc[key]
  if (retiredLogo) {
    const kept = { ...(logo as Record<string, unknown>) }
    for (const key of RETIRED_LOGO_KEYS) delete kept[key]
    doc.brand = { ...(brand as Record<string, unknown>), logo: kept }
  }
  return doc
}

const lookup = (root: unknown, path: Path): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      node !== null && typeof node === 'object'
        ? (node as Record<PropertyKey, unknown>)[key]
        : undefined,
    root
  )

const pathText = (path: Path) => path.map(String).join('.')

/**
 * Whether the design stays valid at this path once its key is gone, which is
 * so only for an optional field: a required one fails again where it was.
 */
function isOptionalField(doc: unknown, path: Path): boolean {
  const parent = lookup(doc, path.slice(0, -1))
  if (!isRecord(parent)) return false
  const trial = structuredClone(doc)
  delete (lookup(trial, path.slice(0, -1)) as Record<PropertyKey, unknown>)[path.at(-1)!]
  const rest = portalDesign.safeParse(trial)
  return (
    rest.success ||
    !rest.error.issues.some(
      (other) => other.path.length === path.length && other.path.every((key, i) => key === path[i])
    )
  )
}

/**
 * Applies the one repair an issue allows, or returns false when it allows
 * none. An unknown key is dropped. A list item that does not parse, such as a
 * menu item of a newer kind, is dropped from its list. An optional field that
 * does not parse, such as an option a newer build added, is dropped on its own.
 * A required option value this build does not offer goes back to the default design's value.
 */
function repair(
  doc: unknown,
  issue: { code: string; path: Path; keys?: string[] },
  dropped: string[]
): boolean {
  if (issue.code === 'unrecognized_keys' && issue.keys) {
    const parent = lookup(doc, issue.path) as Record<string, unknown>
    for (const key of issue.keys) {
      delete parent[key]
      dropped.push(pathText([...issue.path, key]))
    }
    return true
  }
  const index = issue.path.findLastIndex((key) => typeof key === 'number')
  // An optional part of a list item, such as a block's look, goes on its own.
  const optional = issue.path[index + 1]
  if (index >= 0 && typeof optional === 'string' && OPTIONAL_ITEM_FIELDS.has(optional)) {
    const item = lookup(doc, issue.path.slice(0, index + 1)) as Record<string, unknown>
    delete item[optional]
    dropped.push(pathText(issue.path.slice(0, index + 2)))
    return true
  }
  if (index >= 0) {
    const list = lookup(doc, issue.path.slice(0, index)) as unknown[]
    list.splice(issue.path[index] as number, 1)
    dropped.push(pathText(issue.path.slice(0, index + 1)))
    return true
  }
  if (issue.path.length > 0 && issue.path[0] !== 'version' && isOptionalField(doc, issue.path)) {
    const parent = lookup(doc, issue.path.slice(0, -1)) as Record<PropertyKey, unknown>
    delete parent[issue.path.at(-1)!]
    dropped.push(pathText(issue.path))
    return true
  }
  if (issue.code !== 'invalid_value' || issue.path[0] === 'version') return false
  const fallback = lookup(defaultDesign(), issue.path)
  if (fallback === undefined || typeof lookup(doc, issue.path) !== 'string') return false
  const parent = lookup(doc, issue.path.slice(0, -1)) as Record<PropertyKey, unknown>
  parent[issue.path.at(-1)!] = fallback
  dropped.push(pathText(issue.path))
  return true
}

/**
 * A stored design as this build reads it, with the paths it set aside, or
 * null when the document is not a design this build can show.
 */
export function readStoredDesign(
  input: unknown
): { design: PortalDesign; dropped: string[] } | null {
  if (input === null || typeof input !== 'object') return null
  const doc = structuredClone(withoutRetiredKeys(input))
  const dropped: string[] = []
  for (let repairs = 0; repairs <= MAX_REPAIRS; repairs++) {
    const parsed = portalDesign.safeParse(doc)
    if (parsed.success) return { design: parsed.data, dropped }
    const issue = parsed.error.issues[0]!
    if (!repair(doc, issue as never, dropped)) return null
  }
  return null
}
