import { randomUUID } from 'node:crypto'
import { db, settings, assistantPendingActions, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { logger } from '@/lib/server/logger'
import { ForbiddenError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { companyEmailDomain } from '@/lib/server/personal-email-domains'
import { safeWebsiteBrandColor } from '@/lib/shared/website-brand-color'
import { generateThemeCSS } from '@/lib/shared/theme/generator'
import { brandingConfigSchema } from '@/lib/shared/schemas/settings'
import type { ThemeConfig } from '@/lib/shared/theme/types'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'
import { settingsProposalSchema } from '@/lib/shared/assistant/settings-proposals'
import { fetchWebsiteBranding } from '@/lib/server/content/website-branding'
import {
  applySettingsChangesInTransaction,
  prepareRehostedBrandingLogoChange,
  prepareSettingsChanges,
} from './settings-proposals.service'
import { auditAutomaticBranding } from './automatic-website-branding.actions'
import {
  AUTOMATIC_BRANDING_SOURCE,
  AUTOMATIC_BRANDING_TOOL,
  automaticStatusForRow,
  hasLookupAttempt,
  lookupFromRow,
  resolveAutomaticBrandingActor,
  statusFromLookup,
  type BrandingLookup,
  type AutomaticBrandingReceipt,
} from './automatic-website-branding.state'
import {
  invalidateSettingsCache,
  parseJsonOrNull,
  writeMetadataKey,
  type SettingsRecord,
} from '@/lib/server/domains/settings/settings.helpers'
export { undoAutomaticWebsiteBranding } from './automatic-website-branding.actions'

const log = logger.child({ component: 'automatic-website-branding' })
interface LookupClaim {
  row: SettingsRecord
  lookup: BrandingLookup
}

/** An explicit appearance or custom CSS keeps the administrator's chosen theme. */
function hasDefaultTheme(row: SettingsRecord): boolean {
  if (row.customCss?.trim()) return false
  const parsed = brandingConfigSchema.safeParse(
    row.brandingConfig === null ? {} : parseJsonOrNull<ThemeConfig>(row.brandingConfig)
  )
  if (!parsed.success) return false
  const config = parsed.data
  return generateThemeCSS(config) === generateThemeCSS({})
}
async function claimLookup(
  actor: Actor
): Promise<{ claim: LookupClaim | null; status: AutomaticBrandingStatus | null }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).limit(1).for('update')
    if (!row) return { claim: null, status: null }
    let person
    try {
      person = await resolveAutomaticBrandingActor(actor, tx)
    } catch (error) {
      if (error instanceof ForbiddenError) return { claim: null, status: null }
      throw error
    }
    if (hasLookupAttempt(row))
      return { claim: null, status: await automaticStatusForRow(row, person.permissions, tx) }
    const domain = person.email ? companyEmailDomain(person.email) : null
    if (row.logoKey || !domain) return { claim: null, status: null }
    const lookup: BrandingLookup = {
      version: 1,
      status: 'pending',
      domain,
      claimId: randomUUID(),
      ownerPrincipalId: actor.principalId!,
      startedAt: new Date().toISOString(),
      completedAt: null,
      pendingActionId: null,
    }
    await writeMetadataKey('brandingLookup', lookup, { executor: tx })
    return { claim: { row, lookup }, status: statusFromLookup(lookup) }
  })
}
async function markClaim(tx: Transaction, claim: LookupClaim, status: 'failed' | 'skipped') {
  const lookup = { ...claim.lookup, status, completedAt: new Date().toISOString() }
  await writeMetadataKey('brandingLookup', lookup, { executor: tx })
}
export async function getAutomaticWebsiteBrandingStatus(
  actor: Actor
): Promise<AutomaticBrandingStatus | null> {
  const [row] = await db.select().from(settings).limit(1)
  if (!row) return null
  let person
  try {
    person = await resolveAutomaticBrandingActor(actor)
  } catch (error) {
    if (error instanceof ForbiddenError) return null
    throw error
  }
  return automaticStatusForRow(row, person.permissions)
}
export async function ensureAutomaticWebsiteBranding(
  actor: Actor
): Promise<AutomaticBrandingStatus | null> {
  const initial = await claimLookup(actor)
  const claim = initial.claim
  if (!claim) return initial.status
  try {
    // The homepage and logo are fetched without holding a database lock.
    const branding = await fetchWebsiteBranding(claim.lookup.domain)
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(settings).limit(1).for('update')
      const current = row && lookupFromRow(row)
      if (
        !row ||
        row.id !== claim.row.id ||
        current?.claimId !== claim.lookup.claimId ||
        current.status !== 'pending'
      )
        return
      const person = await resolveAutomaticBrandingActor(actor, tx)
      if (row.logoKey) {
        await markClaim(tx, claim, 'skipped')
        return
      }
      if (!branding) {
        await markClaim(tx, claim, 'failed')
        return
      }
      const logo = await prepareRehostedBrandingLogoChange(person.actor, branding.logoKey, tx)
      const color = safeWebsiteBrandColor(branding.color)
      const colorEligible =
        color &&
        person.permissions.has(PERMISSIONS.SETTINGS_BRANDING) &&
        row.brandingConfig === claim.row.brandingConfig &&
        row.customCss === claim.row.customCss &&
        hasDefaultTheme(row)
      const colors = colorEligible
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
      const applied = await applySettingsChangesInTransaction(
        tx,
        person.actor,
        proposal,
        proposal.changes.map((change) => change.id)
      )
      const receipt: AutomaticBrandingReceipt = {
        ...applied,
        source: AUTOMATIC_BRANDING_SOURCE,
        settingsId: row.id,
        claimId: claim.lookup.claimId,
        domain: claim.lookup.domain,
      }
      const [pending] = await tx
        .insert(assistantPendingActions)
        .values({
          workspaceThreadKey: `website-branding:${row.id}`,
          toolName: AUTOMATIC_BRANDING_TOOL,
          args: proposal as unknown as Record<string, unknown>,
          summary: 'Website branding',
          originRole: 'workspace_assistant',
          status: 'executed',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          decidedById: person.actor.principalId,
          decidedAt: new Date(),
          executedAt: new Date(),
          idempotencyKey: `website-branding:${row.id}:${claim.lookup.claimId}`,
          result: receipt as unknown as Record<string, unknown>,
        })
        .returning()
      await auditAutomaticBranding(tx, person, 'branding.website.applied', pending.id, receipt)
      await writeMetadataKey(
        'brandingLookup',
        {
          ...claim.lookup,
          status: 'applied',
          completedAt: new Date().toISOString(),
          pendingActionId: pending.id,
        },
        { executor: tx }
      )
    })
    await invalidateSettingsCache()
  } catch (error) {
    log.warn({ err: error, domain: claim.lookup.domain }, 'automatic website branding failed')
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(settings).limit(1).for('update')
      const current = row && lookupFromRow(row)
      if (
        row?.id === claim.row.id &&
        current?.claimId === claim.lookup.claimId &&
        current.status === 'pending'
      )
        await markClaim(tx, claim, 'failed')
    })
    await invalidateSettingsCache()
  }
  return getAutomaticWebsiteBrandingStatus(actor)
}
