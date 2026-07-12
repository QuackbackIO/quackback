/**
 * Compact catalogue declaration helper (WO-2). Fills the exposure defaults
 * (everything off) and the permissive skeleton payload so per-family files read
 * as a table of `type → exposure`. WO-5 replaces `skeletonPayload` per type with
 * a precise zod schema; the exposure flags here are already authoritative.
 */
import { z } from 'zod'
import { defineEvent, type EventExposure, type EventDefinition } from './define'
import { P } from './payloads'

/** Fallback payload for any type without a precise schema yet. */
export const skeletonPayload = z.record(z.string(), z.unknown())

export function decl(
  type: string,
  entity: string,
  exposure: Partial<EventExposure>,
  requiredScope: string,
  emits: 'always' | 'never' = 'always'
): EventDefinition<Record<string, unknown>> {
  // WO-5: resolve the precise payload schema by type; skeleton is the fallback
  // for any type not yet hardened (keeps the catalogue coverage gate green).
  const payload = (P as Record<string, z.ZodType>)[type] ?? skeletonPayload
  return defineEvent(type, {
    entity,
    version: 1,
    payload: payload as z.ZodType<Record<string, unknown>>,
    exposure: {
      webhook: false,
      workflow: false,
      notification: null,
      activity: null,
      audit: false,
      ...exposure,
    },
    requiredScope,
    emits,
  })
}
