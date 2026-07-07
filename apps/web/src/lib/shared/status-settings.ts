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
  /** Master switch: publishes the page and starts recording uptime history. */
  enabled: boolean
  /** Show the "Status" tab in the portal top nav. */
  portalTabEnabled: boolean
  audience: StatusAudience
  /** Segments allowed to view the page when audience = 'segments'. */
  allowedSegmentIds: string[]
  /** Workspace-wide kill switch for all status emails. */
  emailsDisabled: boolean
  /** Auto-subscribe new/identified end-users to the whole page. */
  autoSubscribe: boolean
  /** Optional blurb under the public page header. */
  pageDescription: string | null
}

export const DEFAULT_STATUS_SETTINGS: StatusSettings = {
  enabled: false,
  portalTabEnabled: true,
  audience: 'public',
  allowedSegmentIds: [],
  emailsDisabled: false,
  autoSubscribe: false,
  pageDescription: null,
}

export const statusSettingsSchema = z
  .object({
    enabled: z.boolean(),
    portalTabEnabled: z.boolean(),
    audience: z.enum(['public', 'authenticated', 'segments']),
    allowedSegmentIds: z.array(z.string()),
    emailsDisabled: z.boolean(),
    autoSubscribe: z.boolean(),
    pageDescription: z.string().max(500).nullable(),
  })
  .partial()

export type UpdateStatusSettingsInput = z.infer<typeof statusSettingsSchema>
