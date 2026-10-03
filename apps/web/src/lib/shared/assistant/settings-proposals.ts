import { z } from 'zod'
import {
  brandingPatchSchema,
  messengerBasicsSchema,
  modulesSchema,
  portalBasicsSchema,
} from '@/lib/shared/schemas/settings'
import { officeHoursScheduleSchema } from '@/lib/shared/office-hours'
import { changelogSettingsSchema } from '@/lib/shared/changelog-settings'

export const SETTINGS_AREAS = [
  'branding',
  'portal',
  'messenger',
  'modules',
  'office_hours',
  'changelog',
] as const
export const settingsAreaSchema = z.enum(SETTINGS_AREAS)
export type SettingsArea = z.infer<typeof settingsAreaSchema>
export const settingsPatchSchemas = {
  branding: brandingPatchSchema,
  portal: portalBasicsSchema,
  messenger: messengerBasicsSchema,
  modules: modulesSchema,
  office_hours: officeHoursScheduleSchema.strict(),
  changelog: changelogSettingsSchema.strict(),
} as const
export const settingsChangeInputSchema = z.discriminatedUnion('area', [
  z.object({ area: z.literal('branding'), patch: settingsPatchSchemas.branding }).strict(),
  z.object({ area: z.literal('portal'), patch: settingsPatchSchemas.portal }).strict(),
  z.object({ area: z.literal('messenger'), patch: settingsPatchSchemas.messenger }).strict(),
  z.object({ area: z.literal('modules'), patch: settingsPatchSchemas.modules }).strict(),
  z.object({ area: z.literal('office_hours'), patch: settingsPatchSchemas.office_hours }).strict(),
  z.object({ area: z.literal('changelog'), patch: settingsPatchSchemas.changelog }).strict(),
])
export const settingsProposalInputSchema = z
  .object({ changes: z.array(settingsChangeInputSchema).min(1).max(20) })
  .strict()
export type SettingsChangeInput = z.infer<typeof settingsChangeInputSchema>
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ])
)
/** What turning Messenger on or off writes besides the derived switch. */
export const MESSENGER_EFFECTS = ['messengerTab', 'widget', 'supportInbox'] as const
export type MessengerEffect = (typeof MESSENGER_EFFECTS)[number]
const changeSchema = z
  .object({
    id: z.string(),
    area: settingsAreaSchema,
    path: z
      .array(
        z
          .string()
          .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
          .refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v))
      )
      .min(1)
      .max(3),
    before: jsonValue,
    after: jsonValue,
    settingsHref: z.string().startsWith('/admin/settings/'),
    beforePreview: z.string().nullable().optional(),
    afterPreview: z.string().nullable().optional(),
    effects: z.array(z.enum(MESSENGER_EFFECTS)).max(MESSENGER_EFFECTS.length).optional(),
  })
  .strict()
  .refine((change) => change.id === `${change.area}.${change.path.join('.')}`)
export const settingsProposalSchema = z
  .object({
    kind: z.literal('settings'),
    version: z.literal(1),
    changes: z.array(changeSchema).min(1).max(80),
  })
  .strict()
  .refine((proposal) => new Set(proposal.changes.map((c) => c.id)).size === proposal.changes.length)
export type SettingsProposal = z.infer<typeof settingsProposalSchema>
export type SettingsChange = SettingsProposal['changes'][number]
export function selectSettingsChanges(proposal: SettingsProposal, ids: string[]): SettingsChange[] {
  if (
    ids.length === 0 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !proposal.changes.some((c) => c.id === id))
  )
    throw new Error('Invalid settings change selection')
  const selected = new Set(ids)
  return proposal.changes.filter((change) => selected.has(change.id))
}
