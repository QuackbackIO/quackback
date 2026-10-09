import { db, type Database, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DomainException, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  settingsChangeInputSchema,
  settingsProposalSchema,
  type SettingsChangeInput,
  type SettingsProposal,
  type SettingsProposalChangeInput,
} from '@/lib/shared/assistant/settings-proposals'
import { fetchWebsiteBranding } from '@/lib/server/content/website-branding'
import { requireAreaPermission } from './settings-proposals.areas'
import {
  prepareSettingsChanges,
  prepareRehostedBrandingLogoChange,
} from './settings-proposals.service'

export interface ResolvedWebsiteSettingsInputs {
  changes: SettingsChangeInput[]
  logoKey: string | null
  preparationNotes: Array<'website_color_unavailable'>
}

/** Permission checks precede network work; website inputs never become stored fields. */
export async function resolveWebsiteSettingsInputs(
  actor: Actor,
  inputs: SettingsProposalChangeInput[],
  executor: Database | Transaction = db
): Promise<ResolvedWebsiteSettingsInputs> {
  const canonical = inputs.map((input) => {
    if (input.area !== 'branding') return settingsChangeInputSchema.parse(input)
    const { website: _website, ...patch } = input.patch
    return settingsChangeInputSchema.parse({ area: 'branding', patch })
  })
  const websiteIndex = inputs.findIndex(
    (input) => input.area === 'branding' && input.patch.website !== undefined
  )
  if (websiteIndex < 0) return { changes: canonical, logoKey: null, preparationNotes: [] }
  for (const input of canonical) await requireAreaPermission(actor, input.area, executor)
  await requireAreaPermission(actor, 'branding', executor, PERMISSIONS.SETTINGS_MANAGE)
  const input = inputs[websiteIndex]
  if (input.area !== 'branding' || input.patch.website === undefined)
    throw new ValidationError('INVALID_SETTINGS_PROPOSAL', 'Choose a website for branding.')
  const fetched = await fetchWebsiteBranding(input.patch.website)
  if (!fetched)
    throw new NotFoundError(
      'WEBSITE_BRANDING_UNAVAILABLE',
      'Choose another website or upload a logo in Portal settings.'
    )
  const original = canonical[websiteIndex]
  if (original.area !== 'branding')
    throw new ValidationError('INVALID_SETTINGS_PROPOSAL', 'Choose a website for branding.')
  if (fetched.color) {
    const manualPrimary = (mode: 'light' | 'dark') =>
      canonical.some(
        (change) => change.area === 'branding' && change.patch[mode]?.primary !== undefined
      )
    canonical[websiteIndex] = settingsChangeInputSchema.parse({
      area: 'branding',
      patch: {
        ...original.patch,
        ...(!manualPrimary('light') && {
          light: { primary: fetched.color, ...original.patch.light },
        }),
        ...(!manualPrimary('dark') && { dark: { primary: fetched.color, ...original.patch.dark } }),
      },
    })
  }
  return {
    changes: canonical,
    logoKey: fetched.logoKey,
    preparationNotes: fetched.color ? [] : ['website_color_unavailable'],
  }
}

/** Prepare trusted logo and typed settings diffs under the same enqueue lock. */
export async function prepareResolvedWebsiteSettingsChanges(
  actor: Actor,
  resolved: ResolvedWebsiteSettingsInputs,
  executor: Database | Transaction
): Promise<SettingsProposal> {
  const changes: SettingsProposal['changes'] = []
  const append = async (prepare: () => Promise<SettingsProposal>) => {
    try {
      changes.push(...(await prepare()).changes)
    } catch (error) {
      if (!(error instanceof DomainException) || error.code !== 'SETTINGS_ALREADY_MATCH')
        throw error
    }
  }
  if (resolved.logoKey)
    await append(() => prepareRehostedBrandingLogoChange(actor, resolved.logoKey!, executor))
  const typed = resolved.changes.filter((input) => Object.keys(input.patch).length > 0)
  if (typed.length > 0) await append(() => prepareSettingsChanges(actor, typed, executor))
  if (changes.length === 0)
    throw new ValidationError('SETTINGS_ALREADY_MATCH', 'These settings already match.')
  return settingsProposalSchema.parse({ kind: 'settings', version: 1, changes })
}
