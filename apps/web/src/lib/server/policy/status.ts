/**
 * Status component view authorization — Layer 2 of the visibility model
 * (Status Product Spec §4): per-component audience narrowing via
 * `statusComponents.segmentIds` ([] = everyone who passed the page-level
 * gate in `domains/status/status.audience.ts`).
 *
 * A status page has exactly one viewer action (view/subscribe), so unlike
 * `policy/boards.ts` this returns a plain boolean rather than a `Decision` —
 * there's no per-action matrix to disambiguate (Status Product Spec §4).
 * Still paired per `policy/types.ts`'s convention: pair every canX() with a
 * matching xFilter() so row checks and list queries can't drift.
 */
import type { SQL } from 'drizzle-orm'
import { statusComponents } from '@/lib/server/db'
import { segmentGateAllows, segmentGateFilter } from './segment-gate'
import type { Actor } from './types'

/** Single-row status component view authorization. */
export function canViewStatusComponent(actor: Actor, component: { segmentIds: string[] }): boolean {
  return segmentGateAllows(actor, component.segmentIds)
}

/**
 * SQL predicate for status component list queries. Row-by-row truthiness
 * must match `canViewStatusComponent` exactly (both delegate to the shared
 * segment-gate primitive).
 */
export function statusComponentViewFilter(actor: Actor): SQL {
  return segmentGateFilter(actor, statusComponents.segmentIds)
}
