/**
 * The zones this workspace has proven it controls, and the one rule for what a
 * proven zone covers.
 *
 * A proof counts only when this workspace holds it. Each source below is a
 * record whose value was minted for one of this workspace's own rows and then
 * found published in the zone:
 *
 * - a verified sending domain. Verification already required the row's own
 *   ownership proof: the `_quackback` token for a domain on the provider's
 *   keys, or the row's own key for one set up with a key of its own. A
 *   verified row that no longer carries either is left out, since nothing it
 *   holds says the zone is this workspace's;
 * - a verified single sign-on domain, proven by its own verification TXT.
 *   Read only when a caller asks for it: a single sign-on domain never proves
 *   another, so the sign-in checks leave it out;
 * - an operator-managed hostname that is ready, which proves that exact
 *   hostname only;
 * - a domain added by name (Settings > Domains) whose status is `verified`.
 *   Only finding the row's own minted token at `_quackback.<name>` sets that
 *   status, so a pending row proves nothing. It covers the domain and the
 *   names under it, and keeps counting through the ownership watch's grace
 *   period, like a sending domain.
 *
 * Everything is read from this workspace's own database on every call. There
 * is no cache: a module-level one would be shared by every workspace a process
 * serves.
 */
import {
  db,
  domains,
  emailSendingDomains,
  eq,
  isNotNull,
  settings,
  ssoVerifiedDomain,
} from '@/lib/server/db'
import type {
  SendingDomainDnsRecord,
  SendingDomainDkimMode,
  SendingDomainProofRecord,
} from '@/lib/server/db'
import {
  SSO_VERIFY_RECORD_HOST,
  ssoVerifyRecordValue,
  type ProvenZoneSource,
} from '@/lib/shared/domain-proof'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'
import { isAtOrUnder, toAsciiDomain } from '@/lib/server/domains/channel-accounts/outbound-identity'
import { isKeyRecord } from '@/lib/server/domains/channel-accounts/dkim-key'
import { ownershipRecordsOf } from '@/lib/server/domains/channel-accounts/sending-identity'
import { recordName } from '@/lib/server/domains/channel-accounts/record-check'
import {
  OWNERSHIP_RECORD_HOST,
  OWNERSHIP_VALUE_PREFIX,
} from '@/lib/server/domains/channel-accounts/sending-domain-records'

export type { ProvenZoneSource }

export interface ProvenZone {
  /** The proven name, in its ASCII spelling. */
  zone: string
  source: ProvenZoneSource
  /** True when the proof covers this name only, not the names under it. */
  exact: boolean
  /**
   * The TXT record that proves it, as a full name and its exact value. Null
   * for a web address, which the operator proved.
   */
  record: { name: string; value: string } | null
}

interface SendingRowProofInput {
  status: string
  dkimMode: SendingDomainDkimMode
  dnsRecords: SendingDomainDnsRecord[] | null
}

/**
 * The record a sending-domain row proves its zone with, or null when it
 * proves nothing: verified, and still carrying the proof its kind of setup is
 * verified with.
 */
function sendingRowProofRecord(row: SendingRowProofInput): SendingDomainProofRecord | null {
  if (row.status !== 'verified') return null
  const records = row.dnsRecords ?? []
  // A row with a key of its own (`byo`, or `shared` over an identity that
  // already existed) is verified by that key; only `easy` by its token.
  return row.dkimMode === 'easy'
    ? (ownershipRecordsOf(records)[0] ?? null)
    : (records.find(isKeyRecord) ?? null)
}

/** Whether a sending-domain row proves its zone. */
export function sendingRowProvesZone(row: SendingRowProofInput): boolean {
  return sendingRowProofRecord(row) !== null
}

/**
 * The proven zone that covers `name`, or null. A zone covers itself and the
 * names under it, never a name above it; an exact zone covers itself only.
 */
export function provenZoneCovering(name: string, zones: readonly ProvenZone[]): ProvenZone | null {
  const candidate = toAsciiDomain(name)
  if (!candidate) return null
  for (const z of zones) {
    const zone = toAsciiDomain(z.zone)
    if (!zone) continue
    if (z.exact ? candidate === zone : isAtOrUnder(candidate, zone)) return z
  }
  return null
}

/**
 * The zones other than those that rest on a domain's own record. A verified
 * domain is proven by its own record, never covered by itself; nor by a
 * sending row issued its token, which is the same record. So whatever asks
 * what ELSE covers a domain reads these, and a check of the domain always
 * reads the record itself. Names are unique among added domains.
 */
export function zonesBesidesDomain(
  domain: { name: string; ownershipToken: string },
  zones: readonly ProvenZone[]
): ProvenZone[] {
  const own = toAsciiDomain(domain.name)
  const record = {
    name: recordName(own, OWNERSHIP_RECORD_HOST),
    value: `${OWNERSHIP_VALUE_PREFIX}${domain.ownershipToken}`,
  }
  return zones.filter(
    (z) =>
      !(z.source === 'domain' && z.zone === own) &&
      !(z.record && z.record.name === record.name && z.record.value === record.value)
  )
}

export function isCoveredByProvenZone(name: string, zones: readonly ProvenZone[]): boolean {
  return provenZoneCovering(name, zones) !== null
}

/**
 * Every zone this workspace has proven, with where each proof came from.
 * Single sign-on domains are included only with `includeSso`.
 */
export async function getProvenZones(
  options: { includeSso?: boolean } = {}
): Promise<ProvenZone[]> {
  const [sending, sso, settingsRows, domainRows] = await Promise.all([
    db
      .select({
        domain: emailSendingDomains.domain,
        status: emailSendingDomains.status,
        dkimMode: emailSendingDomains.dkimMode,
        dnsRecords: emailSendingDomains.dnsRecords,
      })
      .from(emailSendingDomains)
      .where(eq(emailSendingDomains.status, 'verified')),
    options.includeSso
      ? db
          .select({
            name: ssoVerifiedDomain.name,
            verificationToken: ssoVerifiedDomain.verificationToken,
          })
          .from(ssoVerifiedDomain)
          .where(isNotNull(ssoVerifiedDomain.verifiedAt))
      : [],
    db.select({ cloudIdentity: settings.cloudIdentity }).from(settings).limit(1),
    db
      .select({
        name: domains.name,
        ownershipToken: domains.ownershipToken,
        status: domains.status,
      })
      .from(domains),
  ])

  // The `_quackback` record of every domain added by name that is not
  // verified. A sending row issued that domain's token rests on the same
  // record, so it proves nothing while the domain does not: once the domain is
  // demoted for a missing record, the twin cannot keep the zone proven.
  const notVerifiedRecords = new Set(
    domainRows
      .filter((d) => d.status !== 'verified')
      .map(
        (d) =>
          `${recordName(toAsciiDomain(d.name), OWNERSHIP_RECORD_HOST)} ${OWNERSHIP_VALUE_PREFIX}${d.ownershipToken}`
      )
  )

  const zones: ProvenZone[] = []
  for (const row of sending) {
    const proof = sendingRowProofRecord(row)
    const zone = toAsciiDomain(row.domain)
    const name = proof && zone ? recordName(zone, proof.host) : ''
    if (proof && zone && !notVerifiedRecords.has(`${name} ${proof.value}`)) {
      zones.push({
        zone,
        source: 'email-sending',
        exact: false,
        record: { name, value: proof.value },
      })
    }
  }
  for (const row of sso) {
    const zone = toAsciiDomain(row.name)
    if (!zone) continue
    zones.push({
      zone,
      source: 'sso',
      exact: false,
      record: {
        name: recordName(zone, SSO_VERIFY_RECORD_HOST),
        value: ssoVerifyRecordValue(row.verificationToken),
      },
    })
  }
  for (const row of domainRows) {
    if (row.status !== 'verified') continue
    const zone = toAsciiDomain(row.name)
    // A row with no token has nothing of its own to have been verified by.
    if (!zone || !row.ownershipToken) continue
    zones.push({
      zone,
      source: 'domain',
      exact: false,
      record: {
        name: recordName(zone, OWNERSHIP_RECORD_HOST),
        value: `${OWNERSHIP_VALUE_PREFIX}${row.ownershipToken}`,
      },
    })
  }
  const identity = parseIdentityProjection(settingsRows[0]?.cloudIdentity)
  for (const hostname of identity?.customDomains ?? []) {
    if (hostname.readiness === 'ready') {
      zones.push({
        zone: toAsciiDomain(hostname.hostname),
        source: 'web-address',
        exact: true,
        record: null,
      })
    }
  }
  return zones.filter((z) => z.zone !== '')
}

/**
 * The source that proves a single sign-on domain without its own TXT record.
 * Null when none covers it. Other single sign-on domains are not read: one
 * never proves another.
 */
export async function ssoDomainProvenBy(name: string): Promise<ProvenZoneSource | null> {
  return provenZoneCovering(name, await getProvenZones())?.source ?? null
}
