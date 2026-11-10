import { withBlockIds } from './home'
import type { PortalDesign } from './schema'

/** One leaf a draft changes, by its dotted path. Lists count as one leaf. */
export interface DesignChange {
  path: string
  before: unknown
  after: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A value as JSON with every object's keys in order, so key order is never a change. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isObject(inner)
      ? Object.fromEntries(
          Object.keys(inner)
            .sort()
            .map((key) => [key, inner[key]])
        )
      : inner
  )
}

/** Every leaf that differs between two designs, in document order. */
export function designChanges(before: unknown, after: unknown, path = ''): DesignChange[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    return keys.flatMap((key) =>
      designChanges(before[key], after[key], path ? `${path}.${key}` : key)
    )
  }
  if (isObject(before) || isObject(after)) {
    return designChanges(isObject(before) ? before : {}, isObject(after) ? after : {}, path)
  }
  return canonical(before) === canonical(after) ? [] : [{ path, before, after }]
}

/**
 * Fields the builder keeps for itself, not part of the look: when a brand
 * match ran, and the face it could not match. Never listed as a change.
 */
const BOOKKEEPING = /^brand\.(matchedAt|unmatchedFont)(\.|$)/

/** The changes a person sees between two designs: every leaf but the builder's bookkeeping. */
export function shownChanges(before: unknown, after: unknown): DesignChange[] {
  return designChanges(before, after).filter((change) => !BOOKKEEPING.test(change.path))
}

/** Whether two designs are the same, block ids given the same way, as the builder counts changes. */
export function sameDesign(a: PortalDesign, b: PortalDesign): boolean {
  return designChanges(withBlockIds(a), withBlockIds(b)).length === 0
}
