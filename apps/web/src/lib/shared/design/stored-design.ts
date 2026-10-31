/**
 * Reading a design that is already stored. A newer build may have saved
 * fields or option values this build does not know; after a rollback, those
 * designs still render with everything this build understands, rather than
 * falling back to the plain portal. Writes stay strict: this is for reads.
 */
import { defaultDesign, portalDesign, type PortalDesign } from './schema'

type Path = ReadonlyArray<PropertyKey>

/** At most this many repairs, so a document that is not a design ends quickly. */
const MAX_REPAIRS = 40

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
  const doc = structuredClone(input)
  const dropped: string[] = []
  for (let repairs = 0; repairs <= MAX_REPAIRS; repairs++) {
    const parsed = portalDesign.safeParse(doc)
    if (parsed.success) return { design: parsed.data, dropped }
    const issue = parsed.error.issues[0]!
    if (!repair(doc, issue as never, dropped)) return null
  }
  return null
}
