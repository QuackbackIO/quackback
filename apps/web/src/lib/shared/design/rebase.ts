/**
 * A design the server saved from an older draft, put on top of the draft as
 * it is now: Quackback AI's reply is worked out from the draft it read, and a
 * person may change something by hand while it works. Only what the server's
 * design changed from the draft it read moves across; the person's newer
 * changes stay. Where both changed the same thing, the person's change wins,
 * as it was made last.
 */
import { enablePatches, Immer, type Patch } from 'immer'
import { patchesBetween } from './history'

enablePatches()
const immer = new Immer({ autoFreeze: false })

type Path = Patch['path']

/** The value at a path, or undefined. */
function at(doc: unknown, path: Path): unknown {
  let node = doc
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string | number, unknown>)[key]
  }
  return node
}

const idOf = (value: unknown) =>
  value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : undefined

/**
 * Whether two changes touch the same thing: one's path holds the other's, or
 * both reach into a list item that is no longer the same item in `mine`.
 */
function collides(a: Path, b: Path, base: unknown, mine: unknown): boolean {
  const shared = Math.min(a.length, b.length)
  let same = 0
  while (same < shared && a[same] === b[same]) same++
  if (same === shared) return true
  // Both reach into the same list item: still the same item only when its id held.
  for (let i = 0; i < same; i++)
    if (typeof a[i] === 'number') {
      const prefix = a.slice(0, i + 1)
      const was = idOf(at(base, prefix))
      if (was === undefined || was !== idOf(at(mine, prefix))) return true
    }
  return false
}

/**
 * `theirs` (made from `base`) on top of `mine` (also made from `base`). With
 * nothing changed in `mine`, `theirs` itself, its exact values kept.
 */
export function rebaseOnto<T extends object>(base: T, theirs: T, mine: T): T {
  if (mine === base) return theirs
  const [own] = patchesBetween(base, mine)
  if (!own.length) return theirs
  const [changes] = patchesBetween(base, theirs)
  let doc = mine
  for (const patch of changes) {
    if (own.some((each) => collides(patch.path, each.path, base, mine))) continue
    try {
      doc = immer.applyPatches(doc, [patch]) as T
    } catch {
      // A place the person's change removed: it has nowhere to go.
    }
  }
  return doc
}
