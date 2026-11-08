/**
 * Reading a design that is already stored. A newer build may have saved
 * fields or option values this build does not know; after a rollback, those
 * designs still render with everything this build understands, rather than
 * falling back to the plain portal. Writes stay strict: this is for reads,
 * except for what designs no longer have, which migrations.ts takes out of
 * every document on the way in.
 *
 * The read runs the migrations once, then parses, then repairs each field
 * the parse refused, every one from that parse at once, and parses again.
 */
import { defaultDesign, portalDesign, type PortalDesign } from './schema'
import { migrateDesign } from './migrations'

type Path = ReadonlyArray<PropertyKey>
type Issue = { code: string; path: Path; keys?: string[] }

/** Optional fields of a list item that can go without losing the item. */
const OPTIONAL_ITEM_FIELDS = new Set(['look', 'heading', 'label'])

/**
 * At most this many rounds of repair, so a document that is not a design
 * ends quickly. Each round repairs every issue one parse found; a later
 * round only meets what that parse could not see yet, such as a check that
 * runs once the fields under it parse.
 */
const MAX_ROUNDS = 4

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const lookup = (root: unknown, path: Path): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      node !== null && typeof node === 'object'
        ? (node as Record<PropertyKey, unknown>)[key]
        : undefined,
    root
  )

const pathText = (path: Path) => path.map(String).join('.')

const startsWith = (path: Path, prefix: Path) =>
  prefix.length <= path.length && prefix.every((key, i) => path[i] === key)

const samePath = (a: Path, b: Path) => a.length === b.length && startsWith(a, b)

/** The repair an issue asks for, before anything is changed. */
type Repair =
  | { kind: 'keys'; path: Path; keys: string[] }
  | { kind: 'itemField'; path: Path }
  | { kind: 'item'; path: Path }
  | { kind: 'field'; path: Path; issue: Issue }

/**
 * Sorts an issue into its repair. An unknown key is dropped. An optional part
 * of a list item, such as a block's look, goes on its own. Anything else
 * wrong in a list item, such as a menu item of a newer kind, drops the item.
 * The rest is a field: dropped when optional, else set back to the default.
 */
function repairOf(issue: Issue): Repair {
  if (issue.code === 'unrecognized_keys' && issue.keys)
    return { kind: 'keys', path: issue.path, keys: issue.keys }
  const index = issue.path.findLastIndex((key) => typeof key === 'number')
  const optional = issue.path[index + 1]
  if (index >= 0 && typeof optional === 'string' && OPTIONAL_ITEM_FIELDS.has(optional))
    return { kind: 'itemField', path: issue.path.slice(0, index + 2) }
  if (index >= 0) return { kind: 'item', path: issue.path.slice(0, index + 1) }
  return { kind: 'field', path: issue.path, issue }
}

/** Deletes the key at a path, if what holds it is still there. */
function remove(doc: unknown, path: Path): void {
  const parent = lookup(doc, path.slice(0, -1))
  if (isRecord(parent)) delete parent[path.at(-1)!]
}

/**
 * Which of these fields the design can go without: every one is taken out
 * of one copy, parsed once, and a field is required when the copy then
 * fails at that very path, as a missing required key does.
 */
function optionalFields(doc: unknown, paths: Path[]): boolean[] {
  if (!paths.length) return []
  const trial = structuredClone(doc)
  for (const path of paths) remove(trial, path)
  const rest = portalDesign.safeParse(trial)
  if (rest.success) return paths.map(() => true)
  return paths.map((path) => !rest.error.issues.some((other) => samePath(other.path, path)))
}

/**
 * Applies the repairs every issue of one parse allows, noting each path set
 * aside, or returns false when one allows none and the document is not a
 * design this build can show. Items go last, from the end of each list, so
 * the other repairs find what they were found at.
 */
function repairAll(doc: unknown, issues: readonly Issue[], dropped: string[]): boolean {
  const repairs = issues.map(repairOf)
  const items = repairs.filter((r) => r.kind === 'item').map((r) => r.path)
  // Anything inside an item that goes, goes with it.
  const insideItem = (path: Path) =>
    items.some((item) => item.length < path.length && startsWith(path, item))
  const live = repairs.filter((r) => !insideItem(r.kind === 'keys' ? [...r.path, ''] : r.path))
  const fields = live.filter(
    (r): r is Extract<Repair, { kind: 'field' }> =>
      r.kind === 'field' && r.path.length > 0 && r.path[0] !== 'version'
  )
  const optional = optionalFields(
    doc,
    fields.map((r) => r.path)
  )
  const canDrop = new Set(fields.filter((_, i) => optional[i]))
  const splices = new Map<unknown[], Set<number>>()
  const seen = new Set<string>()
  const note = (path: Path) => {
    const text = pathText(path)
    if (!seen.has(text)) dropped.push(text)
    seen.add(text)
  }
  for (const repair of live) {
    switch (repair.kind) {
      case 'keys': {
        const parent = lookup(doc, repair.path)
        if (!isRecord(parent)) break
        for (const key of repair.keys) {
          delete parent[key]
          note([...repair.path, key])
        }
        break
      }
      case 'itemField':
        remove(doc, repair.path)
        note(repair.path)
        break
      case 'item': {
        const list = lookup(doc, repair.path.slice(0, -1))
        if (!Array.isArray(list)) break
        const at = splices.get(list) ?? new Set<number>()
        at.add(repair.path.at(-1) as number)
        splices.set(list, at)
        note(repair.path)
        break
      }
      case 'field': {
        if (canDrop.has(repair)) {
          remove(doc, repair.path)
          note(repair.path)
          break
        }
        // A required option value this build does not offer goes back to the default design's value.
        const { path, issue } = repair
        if (issue.code !== 'invalid_value' || path[0] === 'version') return false
        const fallback = lookup(defaultDesign(), path)
        const parent = lookup(doc, path.slice(0, -1))
        if (fallback === undefined || typeof lookup(doc, path) !== 'string' || !isRecord(parent))
          return false
        parent[path.at(-1)!] = fallback
        note(path)
        break
      }
    }
  }
  for (const [list, at] of splices)
    for (const index of [...at].sort((a, b) => b - a)) list.splice(index, 1)
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
  const doc = structuredClone(migrateDesign(input))
  const dropped: string[] = []
  for (let round = 0; ; round++) {
    const parsed = portalDesign.safeParse(doc)
    if (parsed.success) return { design: parsed.data, dropped }
    if (round === MAX_ROUNDS) return null
    if (!repairAll(doc, parsed.error.issues as readonly Issue[], dropped)) return null
  }
}
