/**
 * Compact catalogue declaration helper (WO-2). Fills the exposure defaults
 * (everything off) and the permissive skeleton payload so per-family files read
 * as a table of `type → exposure`. WO-5 replaces `skeletonPayload` per type with
 * a precise zod schema; the exposure flags here are already authoritative.
 */
import { z } from 'zod'
import { defineEvent, type EventExposure, type EventDefinition } from './define'

/** Permissive payload for the WO-2 skeleton; hardened per type in WO-5. */
export const skeletonPayload = z.record(z.string(), z.unknown())

export function decl(
  type: string,
  entity: string,
  exposure: Partial<EventExposure>,
  requiredScope: string,
  emits: 'always' | 'never' = 'always'
): EventDefinition<Record<string, unknown>> {
  return defineEvent(type, {
    entity,
    version: 1,
    payload: skeletonPayload,
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
