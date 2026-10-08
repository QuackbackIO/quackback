import { z } from 'zod'
import { db, eq, principal, user, type Database, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError, ConflictError } from '@/lib/shared/errors'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'
import { settingsProposalSchema } from '@/lib/shared/assistant/settings-proposals'
import {
  at,
  columnValue,
  equal,
  type SettingsApplyReceipt,
} from '@/lib/server/domains/assistant/settings-proposals.storage'
import {
  parseJsonOrNull,
  writeMetadataKey,
  type SettingsRecord,
} from '@/lib/server/domains/settings/settings.helpers'

export const AUTOMATIC_BRANDING_SOURCE = 'website_branding'
/** A lookup still pending after this long died with its process; it reads as failed. */
export const STALE_CLAIM_MS = 5 * 60_000
/** Home shows an applied or offered logo for this long after the lookup. */
export const NOTICE_WINDOW_MS = 3 * 24 * 60 * 60_000

const AUTOMATIC_CHANGE_IDS = ['branding.logoKey', 'branding.light.primary', 'branding.dark.primary']

const offerSchema = z
  .object({
    logoKey: z
      .string()
      .regex(/^logos\/[a-zA-Z0-9_./-]+$/)
      .max(512),
    color: z
      .string()
      .regex(/^#[0-9A-F]{6}$/)
      .nullable(),
  })
  .strict()
export type BrandingOffer = z.infer<typeof offerSchema>

const storageEffectSchema = z
  .object({
    column: z.enum(['logoKey', 'brandingConfig']),
    path: z.array(z.enum(['light', 'dark', 'primary'])).max(2),
    before: z.unknown(),
    after: z.unknown(),
    beforePresent: z.boolean(),
    afterPresent: z.boolean(),
  })
  .strict()
  .refine((effect) =>
    effect.column === 'logoKey'
      ? effect.path.length === 0
      : effect.path.length === 0 ||
        ((effect.path[0] === 'light' || effect.path[0] === 'dark') &&
          (effect.path.length === 1 || effect.path[1] === 'primary'))
  )

/** The settings receipt Undo restores from, stored with the lookup. */
const receiptSchema = z
  .object({
    kind: z.literal('settings'),
    version: z.literal(1),
    changes: z.array(z.unknown()).min(1).max(3),
    storageEffects: z.array(storageEffectSchema).min(1),
    appliedAt: z.iso.datetime(),
  })
  .strict()

const core = {
  version: z.literal(1),
  domain: z.string().min(1).max(253),
  claimId: z.uuid(),
  ownerPrincipalId: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
}

/**
 * `settings.metadata.brandingLookup`. Any value under that key, including the
 * `{ status: 'skipped', reason: 'existing' }` marker migration 0295 writes for
 * workspaces that predate the lookup, means the lookup never runs again.
 */
export const brandingLookupSchema = z.discriminatedUnion('status', [
  z.object({ ...core, status: z.literal('pending') }).strict(),
  z.object({ ...core, status: z.literal('failed') }).strict(),
  z.object({ ...core, status: z.literal('skipped') }).strict(),
  z.object({ ...core, status: z.literal('offered'), offer: offerSchema }).strict(),
  z.object({ ...core, status: z.literal('declined'), offer: offerSchema }).strict(),
  z
    .object({ ...core, status: z.literal('applied'), offer: offerSchema, receipt: receiptSchema })
    .strict(),
  z
    .object({ ...core, status: z.literal('undone'), offer: offerSchema, receipt: receiptSchema })
    .strict(),
])
export type BrandingLookup = z.infer<typeof brandingLookupSchema>

type Executor = Database | Transaction

export function automaticBrandingPermissionError(): ForbiddenError {
  return new ForbiddenError(
    'WEBSITE_BRANDING_PERMISSION_REQUIRED',
    'Ask a workspace Owner to change the branding.'
  )
}
export function automaticBrandingUnavailable(): ConflictError {
  return new ConflictError(
    'WEBSITE_BRANDING_UNAVAILABLE',
    'This branding change is no longer available.'
  )
}
export function automaticBrandingConflict(): ConflictError {
  return new ConflictError(
    'WEBSITE_BRANDING_UNDO_CONFLICT',
    'The branding changed since then. Undo is unavailable.'
  )
}

export function lookupFromRow(row: SettingsRecord): BrandingLookup | null {
  const parsed = brandingLookupSchema.safeParse(
    parseJsonOrNull<Record<string, unknown>>(row.metadata)?.brandingLookup
  )
  return parsed.success ? parsed.data : null
}
/** Write the lookup only in a shape it can be read back in; anything else aborts the write. */
export async function storeLookup(tx: Transaction, lookup: unknown): Promise<BrandingLookup> {
  const parsed = brandingLookupSchema.parse(lookup)
  await writeMetadataKey('brandingLookup', parsed, { executor: tx })
  return parsed
}
export function hasLookupAttempt(row: SettingsRecord): boolean {
  return Object.hasOwn(
    parseJsonOrNull<Record<string, unknown>>(row.metadata) ?? {},
    'brandingLookup'
  )
}

export async function resolveAutomaticBrandingActor(actor: Actor, executor: Executor = db) {
  if (!actor.principalId || actor.principalType !== 'user') throw automaticBrandingPermissionError()
  const [person] = await executor
    .select({ role: principal.role, type: principal.type, userId: user.id, email: user.email })
    .from(principal)
    .innerJoin(user, eq(principal.userId, user.id))
    .where(eq(principal.id, actor.principalId))
    .limit(1)
  if (!person || person.type !== 'user' || (person.role !== 'admin' && person.role !== 'member'))
    throw automaticBrandingPermissionError()
  const actual = await permissionsForPrincipal(actor.principalId, person.role, executor)
  const permissions = new Set(
    [...actual].filter(
      (permission) => actor.permissions === undefined || actor.permissions.has(permission)
    )
  )
  if (!permissions.has(PERMISSIONS.SETTINGS_MANAGE)) throw automaticBrandingPermissionError()
  return { ...person, actor: { ...actor, role: person.role, permissions } as Actor, permissions }
}
export type AutomaticBrandingPerson = Awaited<ReturnType<typeof resolveAutomaticBrandingActor>>

/** The applied receipt, only when it holds nothing but this lookup's own branding changes. */
export function receiptFromLookup(lookup: BrandingLookup): SettingsApplyReceipt | null {
  if (lookup.status !== 'applied' && lookup.status !== 'undone') return null
  const proposal = settingsProposalSchema.safeParse({
    kind: 'settings',
    version: 1,
    changes: lookup.receipt.changes,
  })
  if (
    !proposal.success ||
    !proposal.data.changes.some(
      (change) => change.id === 'branding.logoKey' && change.after === lookup.offer.logoKey
    ) ||
    proposal.data.changes.some(
      (change) => change.area !== 'branding' || !AUTOMATIC_CHANGE_IDS.includes(change.id)
    )
  )
    return null
  return { ...lookup.receipt, changes: proposal.data.changes } as SettingsApplyReceipt
}

/** Undo needs every stored field it touched to still hold the applied value. */
export function receiptStillApplies(row: SettingsRecord, receipt: SettingsApplyReceipt): boolean {
  return receipt.storageEffects.every((effect) => {
    let current: unknown
    try {
      current = columnValue(row, effect.column)
    } catch {
      return false
    }
    const value = effect.path.length === 0 ? current : at(current, effect.path)
    return (
      equal(value ?? null, effect.after) &&
      (effect.path.length === 0 || (value !== undefined) === effect.afterPresent)
    )
  })
}

export function receiptPermitted(
  permissions: ReadonlySet<PermissionKey>,
  receipt: SettingsApplyReceipt
): boolean {
  return receipt.changes.every((change) =>
    permissions.has(
      change.id === 'branding.logoKey' ? PERMISSIONS.SETTINGS_MANAGE : PERMISSIONS.SETTINGS_BRANDING
    )
  )
}

export function quietStatus(
  domain: string,
  status: AutomaticBrandingStatus['status']
): AutomaticBrandingStatus {
  return { domain, status, logoUrl: null, colorApplied: false, canUndo: false, canUse: false }
}

/**
 * What Home shows for a recorded lookup, or null once there is nothing to show:
 * an offer answered by a logo set by hand, an applied change edited since, or
 * either one older than the notice window.
 */
export function presentLookup(
  row: SettingsRecord,
  lookup: BrandingLookup,
  permissions: ReadonlySet<PermissionKey>,
  now = Date.now()
): AutomaticBrandingStatus | null {
  if (lookup.status === 'pending')
    return quietStatus(
      lookup.domain,
      now - Date.parse(lookup.startedAt) > STALE_CLAIM_MS ? 'failed' : 'pending'
    )
  const recent =
    lookup.completedAt !== null && now - Date.parse(lookup.completedAt) < NOTICE_WINDOW_MS
  if (lookup.status === 'offered') {
    if (!recent || row.logoKey) return null
    return {
      ...quietStatus(lookup.domain, 'offered'),
      logoUrl: getPublicUrlOrNull(lookup.offer.logoKey),
      canUse: true,
    }
  }
  if (lookup.status === 'applied') {
    const receipt = receiptFromLookup(lookup)
    if (!recent || !receipt || !receiptStillApplies(row, receipt)) return null
    return {
      ...quietStatus(lookup.domain, 'applied'),
      logoUrl: getPublicUrlOrNull(lookup.offer.logoKey),
      colorApplied: receipt.changes.some((change) => change.id !== 'branding.logoKey'),
      canUndo: receiptPermitted(permissions, receipt),
    }
  }
  return quietStatus(lookup.domain, lookup.status)
}
