/**
 * Domains added by name on Settings > Domains, and their ownership records.
 *
 * A domain row is the name and a token minted for it, published as
 * `_quackback.<name>` TXT `quackback-domain-verification=<token>`. Only finding
 * this row's own token moves it to `verified`; a pending row proves nothing.
 * A name under a zone this workspace has already proven needs no record: that
 * is worked out each time it is read, never written to the row.
 *
 * What a domain is used for stays in the table that owns each use, joined by
 * name, so a domain is removed only once none of them holds it.
 */
import {
  and,
  asc,
  db,
  domains,
  emailSendingDomains,
  eq,
  isNotNull,
  or,
  settings,
  sql,
  ssoVerifiedDomain,
  type Database,
  type Domain,
  type Transaction,
} from '@/lib/server/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import type { DomainUse } from '@/lib/shared/domains-permissions'
import type { DomainRecordCheck } from '@/lib/shared/domain-proof'
import { lookupVerificationTxt, type LookupResult } from '@/lib/server/auth/dns-verify'
import { verifiableDomain } from '@/lib/server/auth/normalize-domain'
import { interactiveResolver } from '@/lib/server/dns/resolver'
import { toAsciiDomain } from '@/lib/server/utils/mail-domain'
import {
  mintOwnershipToken,
  OWNERSHIP_RECORD_HOST,
  OWNERSHIP_VALUE_PREFIX,
  ownershipRecord,
} from '@/lib/server/domains/channel-accounts/sending-domain-records'
import { recordName } from '@/lib/server/domains/channel-accounts/record-check'
import { GRACE_CLEARED } from '@/lib/server/domains/channel-accounts/ownership-grace'
import { lockDomainName } from '@/lib/server/domains/channel-accounts/sending-domain-token'
import { parseJsonConfig } from '@/lib/server/domains/settings/settings.helpers'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'
import { getProvenZones, provenZoneCovering, zonesBesidesDomain } from './proven-zones'

export type { Domain }

export type DomainOwnershipCheck = DomainRecordCheck

/**
 * Look up a domain's own ownership record, with a second try since a person or
 * a verified domain is waiting on the answer: the lookup's result, and whether
 * it holds the row's own token.
 */
export async function lookupDomainRecord(
  row: Pick<Domain, 'name' | 'ownershipToken'>
): Promise<{ result: LookupResult; found: boolean }> {
  const result = await lookupVerificationTxt(
    recordName(row.name, OWNERSHIP_RECORD_HOST),
    interactiveResolver
  )
  const found = result.ok && result.values.includes(ownershipRecord(row.ownershipToken).value)
  return { result, found }
}

/** The domain's name in its one spelling, or a typed refusal a person can read. */
function parseName(input: string): string {
  const parsed = verifiableDomain.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(
      'INVALID_DOMAIN',
      parsed.error.issues[0]?.message ?? 'Enter a domain like acme.com.'
    )
  }
  return parsed.data
}

export async function getDomain(name: string): Promise<Domain | null> {
  const key = toAsciiDomain(name)
  if (!key) return null
  const [row] = await db.select().from(domains).where(eq(domains.name, key)).limit(1)
  return row ?? null
}

export async function listDomains(): Promise<Domain[]> {
  return db.select().from(domains).orderBy(asc(domains.name))
}

/**
 * Add a domain by its name. Idempotent: a name already added returns its row,
 * token unchanged, so a second add never invalidates a published record.
 */
export async function addDomain(input: string): Promise<Domain> {
  return (await upsertDomain(parseName(input))).domain
}

/** The row at a name in its one spelling: inserted with a fresh token, or the one already there. */
async function upsertDomain(name: string): Promise<{ domain: Domain; created: boolean }> {
  const [inserted] = await db
    .insert(domains)
    .values({ name, ownershipToken: mintOwnershipToken() })
    .onConflictDoNothing({ target: domains.name })
    .returning()
  if (inserted) return { domain: inserted, created: true }
  const existing = await getDomain(name)
  if (!existing) throw new ConflictError('DOMAIN_ADD_RACE', 'Try adding the domain again.')
  return { domain: existing, created: false }
}

/**
 * The domain a use was just given in context (an address added on Settings >
 * Email, a sign-in domain, the help center's domain, a Cloud web address), so
 * it is on Settings > Domains too. Idempotent: a token is minted only for a
 * new row, and an existing row's token and status are never changed. Not a
 * server function: each caller is gated by its own use's permission.
 *
 * A name that is not a domain anyone can prove (reserved, an IP, one label)
 * gets no row, and null.
 */
export async function ensureDomain(
  input: string
): Promise<{ domain: Domain; created: boolean } | null> {
  const parsed = verifiableDomain.safeParse(input)
  return parsed.success ? upsertDomain(parsed.data) : null
}

/**
 * Take back a domain {@link ensureDomain} created for a use that then did not
 * happen: only while it is still pending and nothing holds its name. The check
 * and the delete run under the same lock on the name that issuing its token
 * to a sending row takes (`sending-domain-token.ts`), so an add of the same
 * name at that moment is not left holding a removed domain's token.
 */
export async function discardUnusedDomain(domain: Domain): Promise<void> {
  await db.transaction(async (tx) => {
    await lockDomainName(tx, domain.name)
    if ((await domainUsesOf(domain.name, tx)).length > 0) return
    await tx.delete(domains).where(and(eq(domains.id, domain.id), eq(domains.status, 'pending')))
  })
}

/**
 * Per-domain rate limit on interactive checks (set-if-absent, 10s window),
 * the same window single sign-on verification uses.
 */
async function assertCheckRateLimit(id: string): Promise<void> {
  const { kvSetNx } = await import('@/lib/server/kv/pg-kv')
  if (!(await kvSetNx(`verify-workspace-domain:${id}`, 1, 10))) {
    throw new ConflictError('VERIFY_RATE_LIMITED', 'Wait a few seconds before checking again.')
  }
}

/**
 * Look for the domain's ownership record now. Under an already-proven zone no
 * lookup is made and nothing is written. A found token verifies the row; a
 * missing one leaves its status as it was (a verified row's lapse is the
 * ownership watch's to judge, with its grace period).
 */
export async function checkDomainOwnership(name: string): Promise<DomainOwnershipCheck> {
  const row = await getDomain(name)
  if (!row) throw new NotFoundError('DOMAIN_NOT_FOUND', 'That domain has not been added.')
  await assertCheckRateLimit(row.id)

  // A verified row is re-checked against its own record, never proven by itself.
  const proven = provenZoneCovering(row.name, zonesBesidesDomain(row, await getProvenZones()))
  if (proven) return { ok: true, via: proven.source }

  const { result, found } = await lookupDomainRecord(row)
  const now = new Date()
  await db
    .update(domains)
    .set(
      found
        ? {
            status: 'verified',
            verifiedAt: row.verifiedAt ?? now,
            ...GRACE_CLEARED,
            lastCheckedAt: now,
            updatedAt: now,
          }
        : { lastCheckedAt: now, updatedAt: now }
    )
    .where(eq(domains.id, row.id))
  if (found) return { ok: true, via: 'dns' }
  return { ok: false, reason: result.ok ? 'mismatch' : result.reason }
}

/**
 * A sending check found its row's own `_quackback` record at a name. When that
 * row was issued the token of the domain added at the same name (see
 * `sending-domain-token.ts`), it is the same record, so the domain is verified
 * by the same finding: moved to verified, or its grace period ended. Only this
 * workspace's row at exactly that name, holding exactly that token, is
 * touched; any other value found proves nothing about a domain.
 */
export async function verifyDomainOnFoundRecord(
  name: string,
  record: { host: string; value: string },
  now: Date = new Date()
): Promise<void> {
  const key = toAsciiDomain(name)
  if (!key || record.host !== OWNERSHIP_RECORD_HOST) return
  if (!record.value.startsWith(OWNERSHIP_VALUE_PREFIX)) return
  const token = record.value.slice(OWNERSHIP_VALUE_PREFIX.length)
  if (!token) return
  await db
    .update(domains)
    .set({
      status: 'verified',
      verifiedAt: sql`COALESCE(${domains.verifiedAt}, ${now.toISOString()}::timestamptz)`,
      ...GRACE_CLEARED,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(domains.name, key),
        eq(domains.ownershipToken, token),
        or(eq(domains.status, 'pending'), isNotNull(domains.ownershipMissingSince))
      )
    )
}

/** The rows a domain's uses are worked out from. */
export interface DomainUseRows {
  sending: readonly { domain: string }[]
  signIn: readonly { name: string }[]
  settings: { helpCenterConfig: string | null; cloudIdentity: unknown } | undefined
}

/** The uses that hold this name, in the order every page lists them. */
export async function domainUsesOf(
  name: string,
  executor: Database | Transaction = db
): Promise<DomainUse[]> {
  if (!toAsciiDomain(name)) return []
  const [sending, signIn, settingsRows] = await Promise.all([
    executor.select({ domain: emailSendingDomains.domain }).from(emailSendingDomains),
    executor.select({ name: ssoVerifiedDomain.name }).from(ssoVerifiedDomain),
    executor
      .select({
        helpCenterConfig: settings.helpCenterConfig,
        cloudIdentity: settings.cloudIdentity,
      })
      .from(settings)
      .limit(1),
  ])
  return domainUsesFrom(name, { sending, signIn, settings: settingsRows[0] })
}

/** The uses that hold this name among rows already read, in the order every page lists them. */
export function domainUsesFrom(name: string, rows: DomainUseRows): DomainUse[] {
  const key = toAsciiDomain(name)
  if (!key) return []
  const matches = (value: string | null | undefined) => !!value && toAsciiDomain(value) === key
  const webAddresses = [
    parseJsonConfig(rows.settings?.helpCenterConfig ?? null, DEFAULT_HELP_CENTER_CONFIG).domain
      ?.domain,
    ...(parseIdentityProjection(rows.settings?.cloudIdentity)?.customDomains ?? []).map(
      (h) => h.hostname
    ),
  ]
  const uses: DomainUse[] = []
  if (rows.sending.some((s) => matches(s.domain))) uses.push('email')
  if (webAddresses.some(matches)) uses.push('customDomain')
  if (rows.signIn.some((s) => matches(s.name))) uses.push('signIn')
  return uses
}

/**
 * Remove a domain, refused while any use still holds its name, and while a
 * verified domain is the only proof left for a verified sign-in domain under
 * it: removing it would leave that sign-in domain verified on nothing.
 */
export async function removeDomain(name: string): Promise<void> {
  const row = await getDomain(name)
  if (!row) throw new NotFoundError('DOMAIN_NOT_FOUND', 'That domain has not been added.')
  if ((await domainUsesOf(row.name)).length > 0) {
    throw new ConflictError(
      'DOMAIN_IN_USE',
      'Remove what this domain is used for first, then remove the domain.'
    )
  }
  if (row.status === 'verified') {
    const { signInDomainsLosingProof } = await import('./sso-domain-lapse')
    const { losing, undecided } = await signInDomainsLosingProof(row)
    const resting = [...losing.map((s) => s.name), ...undecided]
    if (resting.length > 0) {
      throw new ConflictError(
        'DOMAIN_PROVES_SIGN_IN',
        `Sign-in for ${resting.join(', ')} is verified through this domain. Add its own record or remove it from Sign-in first.`
      )
    }
  }
  await db.delete(domains).where(eq(domains.id, row.id))
}
