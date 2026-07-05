/**
 * Changelog settings — client-safe types + defaults, mirroring the office
 * hours / ticket settings pattern (no dedicated DB column; the values ride in
 * the `settings.metadata` JSON bag under the `changelogSettings` key, see
 * `domains/settings/settings.changelog.ts`).
 */
import { z } from 'zod'

/** Who can see the public changelog and its category-gated entries. */
export type ChangelogAudience = 'public' | 'authenticated'

export interface ChangelogSettings {
  /** Public visitors vs. signed-in portal users only. */
  audience: ChangelogAudience
  /** Show the "Changelog" tab in the portal top nav. */
  portalTabEnabled: boolean
  /** Turns off comments + reactions on changelog entries (one toggle, per spec). */
  collaborationDisabled: boolean
  /** Auto-subscribe new/identified end-users to changelog emails. */
  autoSubscribe: boolean
  /** Workspace-wide kill switch for all changelog emails. */
  emailsDisabled: boolean
}

export const DEFAULT_CHANGELOG_SETTINGS: ChangelogSettings = {
  audience: 'public',
  portalTabEnabled: true,
  collaborationDisabled: false,
  autoSubscribe: true,
  emailsDisabled: false,
}

export const changelogSettingsSchema = z
  .object({
    audience: z.enum(['public', 'authenticated']),
    portalTabEnabled: z.boolean(),
    collaborationDisabled: z.boolean(),
    autoSubscribe: z.boolean(),
    emailsDisabled: z.boolean(),
  })
  .partial()

export type UpdateChangelogSettingsInput = z.infer<typeof changelogSettingsSchema>
