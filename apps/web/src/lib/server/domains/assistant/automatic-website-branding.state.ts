import { z } from 'zod'
import {
  db,
  eq,
  principal,
  user,
  assistantPendingActions,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError, ConflictError } from '@/lib/shared/errors'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'
import { settingsProposalSchema } from '@/lib/shared/assistant/settings-proposals'
import {
  equal,
  type SettingsApplyReceipt,
} from '@/lib/server/domains/assistant/settings-proposals.storage'
import {
  parseJsonOrNull,
  type SettingsRecord,
} from '@/lib/server/domains/settings/settings.helpers'

export const AUTOMATIC_BRANDING_TOOL = 'automatic_website_branding'
export const AUTOMATIC_BRANDING_SOURCE = 'website_branding'
export const brandingLookupSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(['pending', 'applied', 'undone', 'skipped', 'failed']),
    domain: z.string().min(1).max(253),
    claimId: z.uuid(),
    ownerPrincipalId: z.string().min(1),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    pendingActionId: z.string().nullable(),
  })
  .strict()
export type BrandingLookup = z.infer<typeof brandingLookupSchema>
export interface AutomaticBrandingReceipt extends SettingsApplyReceipt {
  source: typeof AUTOMATIC_BRANDING_SOURCE
  settingsId: string
  claimId: string
  domain: string
  undoneAt?: string
}
export type AutomaticPendingAction = typeof assistantPendingActions.$inferSelect
type Executor = Database | Transaction
export function automaticBrandingPermissionError(): ForbiddenError {
  return new ForbiddenError(
    'WEBSITE_BRANDING_PERMISSION_REQUIRED',
    'Ask a workspace Owner to change the branding.'
  )
}
export function automaticBrandingUnavailable(): ConflictError {
  return new ConflictError(
    'WEBSITE_BRANDING_UNDO_UNAVAILABLE',
    'This logo change cannot be undone.'
  )
}
export function lookupFromRow(row: SettingsRecord): BrandingLookup | null {
  const parsed = brandingLookupSchema.safeParse(
    parseJsonOrNull<Record<string, unknown>>(row.metadata)?.brandingLookup
  )
  return parsed.success ? parsed.data : null
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
const receiptSchema = z
  .object({
    kind: z.literal('settings'),
    version: z.literal(1),
    source: z.literal(AUTOMATIC_BRANDING_SOURCE),
    settingsId: z.string(),
    claimId: z.uuid(),
    domain: z.string(),
    changes: z.array(z.unknown()).min(1).max(3),
    storageEffects: z.array(storageEffectSchema).min(1),
    appliedAt: z.iso.datetime(),
    undoneAt: z.iso.datetime().optional(),
  })
  .strict()

/** The metadata pointer authorizes only this workspace's automatic branding receipt. */
export function automaticReceiptFor(
  row: SettingsRecord,
  lookup: BrandingLookup,
  action: AutomaticPendingAction | undefined
): AutomaticBrandingReceipt | null {
  if (
    !action ||
    action.id !== lookup.pendingActionId ||
    action.workspaceThreadKey !== `website-branding:${row.id}` ||
    action.toolName !== AUTOMATIC_BRANDING_TOOL ||
    action.status !== 'executed' ||
    action.conversationId !== null ||
    action.ticketId !== null
  )
    return null
  const parsed = receiptSchema.safeParse(action.result)
  if (
    !parsed.success ||
    parsed.data.settingsId !== row.id ||
    parsed.data.claimId !== lookup.claimId ||
    parsed.data.domain !== lookup.domain
  )
    return null
  const receiptProposal = settingsProposalSchema.safeParse({
    kind: 'settings',
    version: 1,
    changes: parsed.data.changes,
  })
  const storedProposal = settingsProposalSchema.safeParse(action.args)
  if (
    !receiptProposal.success ||
    !storedProposal.success ||
    !equal(receiptProposal.data.changes, storedProposal.data.changes)
  )
    return null
  if (
    !receiptProposal.data.changes.some((change) => change.id === 'branding.logoKey') ||
    receiptProposal.data.changes.some(
      (change) =>
        change.area !== 'branding' ||
        !['branding.logoKey', 'branding.light.primary', 'branding.dark.primary'].includes(change.id)
    )
  )
    return null
  return { ...parsed.data, changes: receiptProposal.data.changes } as AutomaticBrandingReceipt
}
export function receiptPermissions(
  permissions: ReadonlySet<PermissionKey>,
  receipt: AutomaticBrandingReceipt
): boolean {
  return receipt.changes.every((change) =>
    permissions.has(
      change.id === 'branding.logoKey' ? PERMISSIONS.SETTINGS_MANAGE : PERMISSIONS.SETTINGS_BRANDING
    )
  )
}
export function statusFromLookup(lookup: BrandingLookup, canUndo = false): AutomaticBrandingStatus {
  return {
    domain: lookup.domain,
    pendingActionId: lookup.pendingActionId,
    status: lookup.status,
    canUndo,
  }
}
export async function automaticStatusForRow(
  row: SettingsRecord,
  permissions: ReadonlySet<PermissionKey>,
  executor: Executor = db
): Promise<AutomaticBrandingStatus | null> {
  const lookup = lookupFromRow(row)
  if (!lookup) return null
  if (lookup.status !== 'applied') return statusFromLookup(lookup)
  if (!lookup.pendingActionId) return null
  const [action] = await executor
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, lookup.pendingActionId as AutomaticPendingAction['id']))
    .limit(1)
  const receipt = automaticReceiptFor(row, lookup, action)
  const logo = receipt?.changes.find((change) => change.id === 'branding.logoKey')
  if (!receipt || row.logoKey !== logo?.after) return null
  return statusFromLookup(lookup, !receipt.undoneAt && receiptPermissions(permissions, receipt))
}
