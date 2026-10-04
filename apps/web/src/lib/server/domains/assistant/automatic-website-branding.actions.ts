import { db, settings, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { generateThemeCSS } from '@/lib/shared/theme/generator'
import type { ThemeConfig } from '@/lib/shared/theme/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'
import { settingsProposalSchema } from '@/lib/shared/assistant/settings-proposals'
import {
  applySettingsChangesInTransaction,
  prepareRehostedBrandingLogoChange,
  prepareSettingsChanges,
  undoSettingsChangesInTransaction,
  type SettingsApplyReceipt,
} from './settings-proposals.service'
import {
  invalidateSettingsCache,
  parseJsonOrNull,
  type SettingsRecord,
} from '@/lib/server/domains/settings/settings.helpers'
import {
  AUTOMATIC_BRANDING_SOURCE,
  automaticBrandingConflict,
  automaticBrandingPermissionError,
  automaticBrandingUnavailable,
  lookupFromRow,
  presentLookup,
  receiptFromLookup,
  receiptPermitted,
  receiptStillApplies,
  resolveAutomaticBrandingActor,
  storeLookup,
  type AutomaticBrandingPerson,
  type BrandingLookup,
  type BrandingOffer,
} from './automatic-website-branding.state'

/** An explicit appearance or custom CSS keeps the administrator's chosen theme. */
function hasDefaultTheme(row: SettingsRecord): boolean {
  if (row.customCss?.trim()) return false
  // The page stores what its editor produces, so read the config as stored.
  const config = row.brandingConfig === null ? {} : parseJsonOrNull<ThemeConfig>(row.brandingConfig)
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false
  return generateThemeCSS(config) === generateThemeCSS({})
}

/** Whether the plan allows custom colors, read before any row lock is taken. */
export async function customColorsAllowed(): Promise<boolean> {
  return (await getTierLimits()).features.customColors
}

/**
 * Apply an offered logo, and its color when the theme is still the default,
 * the plan allows custom colors and the teammate may change branding.
 * `baseline` is the row the lookup started from: a theme changed since then
 * keeps its manual choice.
 */
export async function applyOffer(
  tx: Transaction,
  person: AutomaticBrandingPerson,
  row: SettingsRecord,
  offer: BrandingOffer,
  options: { baseline: SettingsRecord; customColors: boolean }
): Promise<SettingsApplyReceipt> {
  const logo = await prepareRehostedBrandingLogoChange(person.actor, offer.logoKey, tx)
  const color =
    options.customColors &&
    person.permissions.has(PERMISSIONS.SETTINGS_BRANDING) &&
    row.brandingConfig === options.baseline.brandingConfig &&
    row.customCss === options.baseline.customCss &&
    hasDefaultTheme(row)
      ? offer.color
      : null
  const colors = color
    ? await prepareSettingsChanges(
        person.actor,
        [{ area: 'branding', patch: { light: { primary: color }, dark: { primary: color } } }],
        tx
      )
    : null
  const proposal = settingsProposalSchema.parse({
    kind: 'settings',
    version: 1,
    changes: [...logo.changes, ...(colors?.changes ?? [])],
  })
  return applySettingsChangesInTransaction(
    tx,
    person.actor,
    proposal,
    proposal.changes.map((change) => change.id)
  )
}

export async function auditAutomaticBranding(
  tx: Transaction,
  person: AutomaticBrandingPerson,
  event: 'branding.website.applied' | 'branding.website.undone',
  settingsId: string,
  lookup: BrandingLookup,
  receipt: SettingsApplyReceipt
) {
  const undo = event === 'branding.website.undone'
  await recordAuditEventInTransaction(tx, {
    event,
    actor: { userId: person.userId, email: person.email, role: person.role, type: 'user' },
    target: { type: 'settings', id: settingsId },
    before: receipt.changes.map((change) => ({
      id: change.id,
      value: undo ? change.after : change.before,
    })),
    after: receipt.changes.map((change) => ({
      id: change.id,
      value: undo ? change.before : change.after,
    })),
    metadata: {
      via: AUTOMATIC_BRANDING_SOURCE,
      domain: lookup.domain,
      claimId: lookup.claimId,
      principalId: person.actor.principalId,
    },
  })
}

async function lockedLookup(tx: Transaction, actor: Actor) {
  const [row] = await tx.select().from(settings).limit(1).for('update')
  if (!row) throw automaticBrandingUnavailable()
  const person = await resolveAutomaticBrandingActor(actor, tx)
  return { row, person, lookup: lookupFromRow(row) }
}

/** "Use it": apply an offered logo, with Undo after. */
export async function acceptWebsiteBrandingOffer(
  actor: Actor
): Promise<AutomaticBrandingStatus | null> {
  const customColors = await customColorsAllowed()
  const result = await db.transaction(async (tx) => {
    const { row, person, lookup } = await lockedLookup(tx, actor)
    if (lookup?.status !== 'offered' || row.logoKey) throw automaticBrandingUnavailable()
    const receipt = await applyOffer(tx, person, row, lookup.offer, {
      baseline: row,
      customColors,
    })
    const next = await storeLookup(tx, {
      ...lookup,
      status: 'applied',
      completedAt: new Date().toISOString(),
      receipt,
    })
    await auditAutomaticBranding(tx, person, 'branding.website.applied', row.id, next, receipt)
    const [after] = await tx.select().from(settings).limit(1)
    return presentLookup(after, next, person.permissions)
  })
  await invalidateSettingsCache()
  return result
}

/** "Not now": keep the default logo and stop offering this one. */
export async function declineWebsiteBrandingOffer(
  actor: Actor
): Promise<AutomaticBrandingStatus | null> {
  const result = await db.transaction(async (tx) => {
    const { row, person, lookup } = await lockedLookup(tx, actor)
    if (lookup?.status !== 'offered') throw automaticBrandingUnavailable()
    const next = await storeLookup(tx, {
      ...lookup,
      status: 'declined',
      completedAt: new Date().toISOString(),
    })
    return presentLookup(row, next, person.permissions)
  })
  await invalidateSettingsCache()
  return result
}

/** Restore every field the automatic change set, when none has changed since. */
export async function undoAutomaticWebsiteBranding(
  actor: Actor
): Promise<AutomaticBrandingStatus | null> {
  const result = await db.transaction(async (tx) => {
    const { row, person, lookup } = await lockedLookup(tx, actor)
    const receipt = lookup?.status === 'applied' ? receiptFromLookup(lookup) : null
    if (!lookup || !receipt) throw automaticBrandingUnavailable()
    if (!receiptPermitted(person.permissions, receipt)) throw automaticBrandingPermissionError()
    if (!receiptStillApplies(row, receipt)) throw automaticBrandingConflict()
    try {
      await undoSettingsChangesInTransaction(tx, person.actor, receipt)
    } catch (error) {
      if (error instanceof ForbiddenError) throw automaticBrandingPermissionError()
      if (error instanceof ValidationError && error.code === 'SETTINGS_UNDO_CONFLICT')
        throw automaticBrandingConflict()
      throw error
    }
    await auditAutomaticBranding(tx, person, 'branding.website.undone', row.id, lookup, receipt)
    const next = await storeLookup(tx, {
      ...lookup,
      status: 'undone',
      completedAt: new Date().toISOString(),
    })
    return presentLookup(row, next, person.permissions)
  })
  await invalidateSettingsCache()
  return result
}
