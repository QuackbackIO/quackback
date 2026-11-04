/**
 * Bringing this workspace's mail provider tenant in line with what it sends.
 *
 * Idempotent and safe to stop anywhere. Each run creates the tenant if it is
 * missing, associates the configuration set, the platform sender's identity
 * and the identity of every sending domain this workspace has, releases
 * identities it no longer uses, and reads the tenant's sending status. Every
 * association is made again on every run, which costs a call each and repairs
 * one removed by hand.
 *
 * The tenant is marked ready only when the tenant, the configuration set and
 * the platform identity were all associated on this run. A run that falls
 * short leaves it unready, which sends everything untenanted until a later run
 * completes; that is how the workspace sent before tenants, so a partial
 * failure costs isolation for a while and never a message.
 *
 * Only From domains whose identity was associated on this run are recorded as
 * sendable under the tenant, so the send path can never name the tenant for a
 * From the provider would refuse.
 */
import { getEmailFrom } from '@quackback/email'
import { addressDomain } from '@quackback/email/ses'
import { getSesDomainIdentity, type SesIdentityDeps } from '@quackback/email/ses-identity'
import {
  associateSesTenantResource,
  disassociateSesTenantResource,
  ensureSesTenant,
  getSesTenantReputation,
  sesArnPrefix,
  sesConfigurationSetArn,
  sesIdentityArn,
  type SesTenantDeps,
} from '@quackback/email/ses-tenant'
import {
  and,
  db,
  eq,
  isNull,
  channelAccounts,
  emailSendingDomains,
  emailSesTenants,
} from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { ensureSesTenantState, sesTenantName } from './ses-tenant-state'
import { recordSesTenantStatus } from './ses-tenant-status'

const log = logger.child({ component: 'ses-tenant-reconcile' })

/** How long one run may spend before it stops and leaves the rest unready. */
export const RECONCILE_BUDGET_MS = 20_000

/** Parent domains tried above a From domain when finding its identity. */
const MAX_IDENTITY_WALK = 4

export interface ReconcileDeps {
  tenant?: SesTenantDeps
  identity?: SesIdentityDeps
  clock?: () => number
  env?: Record<string, string | undefined>
}

export type ReconcileResult =
  | { skipped: true }
  | { skipped: false; ready: boolean; errors: string[] }

class OutOfTime extends Error {}

/** This domain and its parents, most specific first, stopping above two labels. */
function domainAndParents(domain: string): string[] {
  const labels = domain.split('.')
  const out: string[] = []
  for (let i = 0; i <= labels.length - 2 && out.length < MAX_IDENTITY_WALK; i++) {
    out.push(labels.slice(i).join('.'))
  }
  return out
}

/** The platform's own From domain, or null when none is configured. */
function platformFromDomain(): string | null {
  try {
    return addressDomain(getEmailFrom())
  } catch {
    return null
  }
}

export async function reconcileSesTenant(deps: ReconcileDeps = {}): Promise<ReconcileResult> {
  const env = deps.env ?? process.env
  const name = sesTenantName(env)
  const configurationSet = env.EMAIL_SES_CONFIGURATION_SET?.trim()
  if (!name || !configurationSet) return { skipped: true }

  const clock = deps.clock ?? Date.now
  const started = clock()
  const spend = () => {
    if (clock() - started >= RECONCILE_BUDGET_MS) throw new OutOfTime('out of time')
  }
  const errors: string[] = []
  const state = await ensureSesTenantState(name)

  /** The most specific verified identity covering a From domain, or null. */
  const identityFor = async (domain: string): Promise<string | null> => {
    for (const candidate of domainAndParents(domain)) {
      spend()
      const found = await getSesDomainIdentity(candidate, deps.identity)
      if (found?.verifiedForSending) return candidate
    }
    return null
  }

  const associated = new Set<string>()
  const fromDomains = new Set<string>()
  let tenantArn = state.tenantArn
  let configSetDone = false
  let platformDone = false
  try {
    spend()
    const tenant = await ensureSesTenant(name, deps.tenant)
    tenantArn = tenant.arn
    const prefix = sesArnPrefix(tenant.arn)
    if (!prefix) throw new Error(`unreadable tenant ARN ${tenant.arn}`)

    const associate = async (arn: string): Promise<boolean> => {
      spend()
      try {
        await associateSesTenantResource(name, arn, deps.tenant)
        associated.add(arn)
        return true
      } catch (err) {
        if (err instanceof OutOfTime) throw err
        errors.push(err instanceof Error ? err.message : String(err))
        return false
      }
    }

    configSetDone = await associate(sesConfigurationSetArn(prefix, configurationSet))

    const platformDomain = platformFromDomain()
    const platformIdentity = platformDomain ? await identityFor(platformDomain) : null
    if (platformDomain && platformIdentity) {
      platformDone = await associate(sesIdentityArn(prefix, platformIdentity))
      if (platformDone) fromDomains.add(platformDomain)
    }

    // Every sending domain whose identity exists, verified or not: associating
    // early is harmless, and a domain is then sendable the moment it verifies.
    const rows = await db.select({ domain: emailSendingDomains.domain }).from(emailSendingDomains)
    const rowDomains = new Set(rows.map((r) => r.domain.toLowerCase()))
    for (const domain of rowDomains) {
      spend()
      const identity = await getSesDomainIdentity(domain, deps.identity)
      if (!identity) continue
      const done = await associate(sesIdentityArn(prefix, domain))
      if (done && identity.verifiedForSending) fromDomains.add(domain)
    }

    // Addresses on a subdomain of a sending domain send as whichever identity
    // is most specific, so each such From domain is resolved on its own.
    for (const domain of await liveAddressDomains()) {
      if (fromDomains.has(domain)) continue
      const identity = await identityFor(domain)
      if (identity && associated.has(sesIdentityArn(prefix, identity))) fromDomains.add(domain)
    }

    // Identities this workspace no longer uses are released, so the operator
    // can delete them. One still used here was associated above and is kept.
    for (const arn of state.associatedArns) {
      if (associated.has(arn) || !arn.startsWith(`${prefix}:identity/`)) continue
      spend()
      try {
        await disassociateSesTenantResource(name, arn, deps.tenant)
      } catch (err) {
        if (err instanceof OutOfTime) throw err
        associated.add(arn)
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    spend()
    try {
      await recordSesTenantStatus(name, await getSesTenantReputation(tenant.arn, deps.tenant))
    } catch (err) {
      if (err instanceof OutOfTime) throw err
      errors.push(err instanceof Error ? err.message : String(err))
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    // Associations not reached this run are still in place at the provider;
    // keeping them listed means a later run can still release them.
    for (const arn of state.associatedArns) associated.add(arn)
  }

  const ready = Boolean(tenantArn) && configSetDone && platformDone
  const now = new Date()
  await db
    .update(emailSesTenants)
    .set({
      tenantArn,
      associatedArns: [...associated].sort(),
      fromDomains: ready ? [...fromDomains].sort() : [],
      configurationSet,
      readyAt: ready ? (state.readyAt ?? now) : null,
      reconciledAt: now,
      lastError: errors.length > 0 ? errors.join('; ').slice(0, 1000) : null,
      updatedAt: now,
    })
    .where(eq(emailSesTenants.tenantName, name))

  if (errors.length > 0) log.warn({ tenant: name, ready, errors }, 'ses tenant reconcile incomplete')
  else log.info({ tenant: name, ready, from_domains: fromDomains.size }, 'ses tenant reconciled')
  return { skipped: false, ready, errors }
}

/** The domains of this workspace's live sending addresses. */
async function liveAddressDomains(): Promise<string[]> {
  const rows = await db
    .select({ address: channelAccounts.address })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.role, 'sending'), isNull(channelAccounts.deletedAt)))
  const domains = new Set<string>()
  for (const row of rows) {
    const domain = addressDomain(row.address ?? undefined)
    if (domain) domains.add(domain)
  }
  return [...domains]
}
