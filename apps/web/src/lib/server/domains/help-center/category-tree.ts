/**
 * Pure helpers for walking the help center category hierarchy.
 *
 * The full non-deleted category list is already cheap to load (the tree is
 * small and the DB has an index on parent_id). Everything here works over a
 * flat array so service callers can load once and run multiple checks.
 */

/** Maximum allowed depth of the category tree. */
export const MAX_CATEGORY_DEPTH = 3

interface CategoryLike {
  id: string
  parentId: string | null
}

/**
 * Collect the set of ids that are descendants of the given root.
 * Does NOT include the root itself. Safe in the presence of a cycle in the
 * input data — each node is visited at most once.
 */
export function collectDescendantIds<T extends CategoryLike>(
  flat: T[],
  rootId: string
): Set<string> {
  const byParent = new Map<string, T[]>()
  for (const cat of flat) {
    if (cat.parentId === null) continue
    const siblings = byParent.get(cat.parentId)
    if (siblings) siblings.push(cat)
    else byParent.set(cat.parentId, [cat])
  }

  const out = new Set<string>()
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const current = stack.pop()!
    const children = byParent.get(current)
    if (!children) continue
    for (const child of children) {
      if (out.has(child.id)) continue
      out.add(child.id)
      stack.push(child.id)
    }
  }
  return out
}

/** Same as collectDescendantIds, but the returned set also contains the root id. */
export function collectDescendantIdsIncludingSelf<T extends CategoryLike>(
  flat: T[],
  rootId: string
): Set<string> {
  const exists = flat.some((c) => c.id === rootId)
  if (!exists) return new Set()
  const out = collectDescendantIds(flat, rootId)
  out.add(rootId)
  return out
}

/**
 * Map each category id to its direct count plus the sum of its descendants'.
 * Every id in `flat` gets an entry (0 when nothing contributes).
 *
 * Walks up from each contributing node to its ancestors, so cost is O(n*d)
 * where d is tree depth (capped by MAX_CATEGORY_DEPTH). Cycle-safe: each walk
 * tracks its visited ancestors so a corrupted `parentId` loop terminates.
 */
export function computeRecursiveCounts<T extends CategoryLike>(
  flat: T[],
  directCount: (id: string) => number
): Map<string, number> {
  const byId = new Map(flat.map((c) => [c.id, c]))
  const out = new Map<string, number>()
  for (const cat of flat) out.set(cat.id, directCount(cat.id))

  for (const cat of flat) {
    const own = directCount(cat.id)
    if (own === 0) continue
    const seen = new Set<string>([cat.id])
    let parentId = cat.parentId
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId)
      out.set(parentId, (out.get(parentId) ?? 0) + own)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  return out
}

/**
 * Walk from the given category up to its top-level ancestor.
 * Depth is the number of ancestors above — 0 for top-level.
 *
 * Unknown ids return 0 (treated as a fresh top-level category). Cycles are
 * bailed out of after visiting more nodes than exist in the input.
 */
export function getCategoryDepth<T extends CategoryLike>(flat: T[], id: string): number {
  const byId = new Map(flat.map((c) => [c.id, c]))
  const start = byId.get(id)
  if (!start) return 0
  let depth = 0
  let current: T = start
  const seen = new Set<string>()
  while (current.parentId !== null) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    const parent = byId.get(current.parentId)
    if (!parent) break
    depth++
    current = parent
    if (depth > flat.length) break
  }
  return depth
}

/**
 * Return the maximum depth of the subtree rooted at the given id, where a
 * leaf has height 0, a node with one layer of children has height 1, and so on.
 *
 * Unknown ids return 0.
 */
export function getSubtreeMaxDepth<T extends CategoryLike>(flat: T[], rootId: string): number {
  const byParent = new Map<string, T[]>()
  for (const cat of flat) {
    if (cat.parentId === null) continue
    const siblings = byParent.get(cat.parentId)
    if (siblings) siblings.push(cat)
    else byParent.set(cat.parentId, [cat])
  }

  function walk(id: string, visited: Set<string>): number {
    if (visited.has(id)) return 0
    visited.add(id)
    const children = byParent.get(id)
    if (!children || children.length === 0) return 0
    let max = 0
    for (const child of children) {
      const h = walk(child.id, visited)
      if (h + 1 > max) max = h + 1
    }
    return max
  }

  if (!flat.some((c) => c.id === rootId)) return 0
  return walk(rootId, new Set())
}

/**
 * Build the ancestor chain from the top-level ancestor down to (and including)
 * the given category. Returns an empty array if the id doesn't exist.
 */
export function buildAncestorChain<T extends CategoryLike>(flat: T[], id: string): T[] {
  const byId = new Map(flat.map((c) => [c.id, c]))
  const start = byId.get(id)
  if (!start) return []

  const chain: T[] = []
  const seen = new Set<string>()
  let current: T | undefined = start
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.push(current)
    if (current.parentId === null) break
    current = byId.get(current.parentId)
  }
  return chain.reverse()
}
