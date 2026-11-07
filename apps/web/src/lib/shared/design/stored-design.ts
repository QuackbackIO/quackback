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

/**
 * A design document without the keys designs no longer have, so one stored,
 * sent or written before they went still reads. The document given stays as it is.
 */
export function withoutRetiredKeys(input: unknown): unknown {
  if (!isRecord(input)) return input
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
 * Applies the one repair an issue allows, or returns false when it allows
 * none. An unknown key is dropped. A list item that does not parse, such as a
 * menu item of a newer kind, is dropped from its list. An option value this
 * build does not offer goes back to the default design's value.
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
