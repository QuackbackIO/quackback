/**
 * Status page settings — client-safe types + defaults, mirroring the
 * changelog settings pattern (no dedicated DB column; the values ride in the
 * `settings.metadata` JSON bag under the `statusSettings` key, see
 * `domains/settings/settings.status.ts`).
 */
import { z } from 'zod'

/**
 * Page visibility ladder: public visitors, signed-in portal users, or only
 * signed-in users sharing one of `allowedSegmentIds`. The portal's own access
 * gate always applies first. Components can additionally be narrowed to
 * segments via `statusComponents.segmentIds`.
 */
export type StatusAudience = 'public' | 'authenticated' | 'segments'

export interface StatusSettings {
  /**
   * Legacy publish bit. The General Status product toggle is the single
   * publish control: ON writes this true (clearing a stored false); OFF
   * only flips `featureFlags.statusPage`. Effective published state is
   * {@link isStatusPagePublished}.
   */
  enabled: boolean
  /**
   * @deprecated Ignored at read time. Portal chrome is Portal → Navigation.
   */
  portalTabEnabled: boolean
  audience: StatusAudience
  /** Segments allowed to view the page when audience = 'segments'. */
  allowedSegmentIds: string[]
  /** Workspace-wide kill switch for all status emails. */
  emailsDisabled: boolean
  /** Optional blurb under the public page header. */
  pageDescription: string | null
}

export const DEFAULT_STATUS_SETTINGS: StatusSettings = {
  enabled: false,
  portalTabEnabled: true,
  audience: 'public',
  allowedSegmentIds: [],
  emailsDisabled: false,
  pageDescription: null,
}

/**
 * Effective status-page publish state: the General product flag AND the
 * legacy `statusSettings.enabled` bit. `enabled !== false` keeps a
 * workspace that stored the flag on but the page unpublished from going
 * live on upgrade until the General toggle is flipped (which writes both).
 */
export function isStatusPagePublished(
  flags: { statusPage?: boolean } | null | undefined,
  statusSettings: { enabled?: boolean } | null | undefined
): boolean {
  return !!flags?.statusPage && statusSettings?.enabled !== false
}

export const statusSettingsSchema = z
  .object({
    enabled: z.boolean(),
    portalTabEnabled: z.boolean(),
    audience: z.enum(['public', 'authenticated', 'segments']),
    allowedSegmentIds: z.array(z.string()),
    emailsDisabled: z.boolean(),
    pageDescription: z.string().max(500).nullable(),
  })
  .partial()

export type UpdateStatusSettingsInput = z.infer<typeof statusSettingsSchema>
