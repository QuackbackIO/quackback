import { randomUUID } from 'node:crypto'
import { db, settings, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { logger } from '@/lib/server/logger'
import { ForbiddenError } from '@/lib/shared/errors'
import { companyEmailDomain } from '@/lib/server/personal-email-domains'
import { getSetupState } from '@/lib/shared/db-types'
import { isLaunchWindowOpen, launchWindowFor } from '@/lib/shared/launch-window'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'
import { fetchWebsiteBranding } from '@/lib/server/content/website-branding'
import {
  invalidateSettingsCache,
  type SettingsRecord,
} from '@/lib/server/domains/settings/settings.helpers'
import { automaticBrandingAvailable } from './automatic-website-branding.availability'
import {
  applyOffer,
  auditAutomaticBranding,
  customColorsAllowed,
} from './automatic-website-branding.actions'
import {
  hasLookupAttempt,
  lookupFromRow,
  presentLookup,
  quietStatus,
  resolveAutomaticBrandingActor,
  storeLookup,
  type AutomaticBrandingPerson,
  type BrandingLookup,
} from './automatic-website-branding.state'
export {
  acceptWebsiteBrandingOffer,
  declineWebsiteBrandingOffer,
  undoAutomaticWebsiteBranding,
} from './automatic-website-branding.actions'

const log = logger.child({ component: 'automatic-website-branding' })

async function permittedPerson(
  actor: Actor,
  executor?: Transaction
): Promise<AutomaticBrandingPerson | null> {
  try {
    return await resolveAutomaticBrandingActor(actor, executor)
  } catch (error) {
    if (error instanceof ForbiddenError) return null
    throw error
  }
}

/**
 * The domain this teammate's lookup would fetch, or null when it may not run
 * for them: the operator switched it off, storage cannot hold a logo, their
 * email is personal, or the workspace is past its launch window (automatic
 * branding is first-run behaviour).
 */
function lookupDomain(person: AutomaticBrandingPerson, row: SettingsRecord): string | null {
  if (!automaticBrandingAvailable()) return null
  const window = launchWindowFor({
    setupState: getSetupState(row.setupState),
    workspaceCreatedAt: row.createdAt,
  })
  if (!isLaunchWindowOpen(window)) return null
  return person.email ? companyEmailDomain(person.email) : null
}

/**
 * Home's read. A workspace that has never been looked up reads as `eligible`
 * only for a teammate who may start the lookup, so nobody else ever asks for
 * the row lock; everything already recorded reads without one.
 */
export async function getAutomaticWebsiteBrandingStatus(
  actor: Actor
): Promise<AutomaticBrandingStatus | null> {
  const [row] = await db.select().from(settings).limit(1)
  if (!row) return null
  const person = await permittedPerson(actor)
  if (!person) return null
  if (!hasLookupAttempt(row)) {
    const domain = lookupDomain(person, row)
    return domain ? quietStatus(domain, 'eligible') : null
  }
  const lookup = lookupFromRow(row)
  return lookup ? presentLookup(row, lookup, person.permissions) : null
}

interface LookupClaim {
  row: SettingsRecord
  lookup: BrandingLookup
}

/**
 * Claim the one lookup under the settings row lock. A workspace that already
 * has a logo is recorded as skipped, so a logo removed later on purpose is
 * never replaced by the website's.
 */
async function claimLookup(
  actor: Actor
): Promise<{ claim: LookupClaim | null; status: AutomaticBrandingStatus | null }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).limit(1).for('update')
    if (!row) return { claim: null, status: null }
    const person = await permittedPerson(actor, tx)
    if (!person) return { claim: null, status: null }
    if (hasLookupAttempt(row)) {
      const recorded = lookupFromRow(row)
      return {
        claim: null,
        status: recorded ? presentLookup(row, recorded, person.permissions) : null,
      }
    }
    const domain = lookupDomain(person, row)
    if (!domain) return { claim: null, status: null }
    const now = new Date().toISOString()
    const lookup = await storeLookup(tx, {
      version: 1,
      status: row.logoKey ? 'skipped' : 'pending',
      domain,
      claimId: randomUUID(),
      ownerPrincipalId: actor.principalId,
      startedAt: now,
      completedAt: row.logoKey ? now : null,
    })
    return {
      claim: lookup.status === 'pending' ? { row, lookup } : null,
      status: quietStatus(domain, lookup.status),
    }
  })
}

async function completeClaim(
  claim: LookupClaim,
  next: (tx: Transaction, row: SettingsRecord) => Promise<void>
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).limit(1).for('update')
    const current = row && lookupFromRow(row)
    if (
      row?.id !== claim.row.id ||
      current?.claimId !== claim.lookup.claimId ||
      current.status !== 'pending'
    )
      return
    await next(tx, row)
  })
  await invalidateSettingsCache()
}

const finish = (claim: LookupClaim, status: 'failed' | 'skipped') =>
  completeClaim(claim, async (tx) => {
    await storeLookup(tx, { ...claim.lookup, status, completedAt: new Date().toISOString() })
  })

/**
 * Home's start. Runs the lookup once per workspace: a good logo is applied
 * with Undo, a weak one is offered, and a failed fetch is recorded.
 */
export async function ensureAutomaticWebsiteBranding(
  actor: Actor
): Promise<AutomaticBrandingStatus | null> {
  const initial = await claimLookup(actor)
  const claim = initial.claim
  if (!claim) return initial.status
  try {
    // The homepage and logo are fetched without holding a database lock.
    const branding = await fetchWebsiteBranding(claim.lookup.domain)
    const customColors = await customColorsAllowed()
    await completeClaim(claim, async (tx, row) => {
      const person = await resolveAutomaticBrandingActor(actor, tx)
      const completedAt = new Date().toISOString()
      if (row.logoKey || !branding) {
        await storeLookup(tx, {
          ...claim.lookup,
          status: row.logoKey ? 'skipped' : 'failed',
          completedAt,
        })
        return
      }
      const offer = { logoKey: branding.logoKey, color: branding.color }
      if (branding.quality === 'weak') {
        await storeLookup(tx, { ...claim.lookup, status: 'offered', completedAt, offer })
        return
      }
      const receipt = await applyOffer(tx, person, row, offer, {
        baseline: claim.row,
        customColors,
      })
      const applied = await storeLookup(tx, {
        ...claim.lookup,
        status: 'applied',
        completedAt,
        offer,
        receipt,
      })
      await auditAutomaticBranding(tx, person, 'branding.website.applied', row.id, applied, receipt)
    })
  } catch (error) {
    log.warn({ err: error, domain: claim.lookup.domain }, 'automatic website branding failed')
    await finish(claim, 'failed')
  }
  return getAutomaticWebsiteBrandingStatus(actor)
}
