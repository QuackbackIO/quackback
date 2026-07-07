/**
 * Status page audience gate — Layer 1 of the visibility model (Status
 * Product Spec §4): the whole-page gate, evaluated with `tierAllows` exactly
 * like `isChangelogAudienceGranted` extended with the `segments` tier.
 * Layer 2 (per-component narrowing) lives in `policy/status.ts`.
 *
 * Settings are passed in (not fetched here) — callers already resolve
 * `StatusSettings` once via `getStatusSettings()` to build the page snapshot.
 */
import type { AccessTier } from '@/lib/server/db'
import { tierAllows } from '@/lib/server/policy/access'
import type { Actor } from '@/lib/server/policy/types'
import type { StatusSettings } from '@/lib/shared/status-settings'

export function isStatusAudienceGranted(
  actor: Actor,
  settings: Pick<StatusSettings, 'audience' | 'allowedSegmentIds'>
): boolean {
  // StatusAudience ('public'|'authenticated'|'segments') is a subset of
  // AccessTier ('anonymous'|'authenticated'|'segments'|'team'); 'public' maps
  // to the 'anonymous' tier (tierAllows always allows it).
  const tier: AccessTier = settings.audience === 'public' ? 'anonymous' : settings.audience
  return tierAllows(actor, tier, settings.allowedSegmentIds)
}
