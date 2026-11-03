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
 *   keys, or the row's own signing key for one that brought its own. A
 *   verified row that no longer carries either is left out, since nothing it
 *   holds says the zone is this workspace's;
 * - a verified single sign-on domain, proven by its `_quackback-verify` TXT;
 * - an operator-managed hostname that is ready, which proves that exact
 *   hostname only.
 *
 * Everything is read from this workspace's own database on every call. There
 * is no cache: a module-level one would be shared by every workspace a process
 * serves.
 */
import {
  db,
  emailSendingDomains,
  eq,
  isNotNull,
  settings,
  ssoVerifiedDomain,
} from '@/lib/server/db'
import type { SendingDomainDnsRecord, SendingDomainDkimMode } from '@/lib/server/db'
import type { ProvenZoneSource } from '@/lib/shared/domain-proof'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'
import { isAtOrUnder, toAsciiDomain } from '@/lib/server/domains/channel-accounts/outbound-identity'
import { isKeyRecord } from '@/lib/server/domains/channel-accounts/dkim-key'
import { ownershipRecordsOf } from '@/lib/server/domains/channel-accounts/sending-identity'

export type { ProvenZoneSource }

export interface ProvenZone {
  /** The proven name, in its ASCII spelling. */
  zone: string
  source: ProvenZoneSource
  /** True when the proof covers this name only, not the names under it. */
  exact: boolean
}

/**
 * Whether a sending-domain row proves its zone: verified, and still carrying
 * the proof its kind of setup is verified with.
 */
export function sendingRowProvesZone(row: {
  status: string
  dkimMode: SendingDomainDkimMode
  dnsRecords: SendingDomainDnsRecord[] | null
}): boolean {
  if (row.status !== 'verified') return false
  const records = row.dnsRecords ?? []
  return row.dkimMode === 'byo' ? records.some(isKeyRecord) : ownershipRecordsOf(records).length > 0
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

export function isCoveredByProvenZone(name: string, zones: readonly ProvenZone[]): boolean {
  return provenZoneCovering(name, zones) !== null
}

/** Every zone this workspace has proven, with where each proof came from. */
export async function getProvenZones(): Promise<ProvenZone[]> {
  const [sending, sso, settingsRows] = await Promise.all([
    db
      .select({
        domain: emailSendingDomains.domain,
        status: emailSendingDomains.status,
        dkimMode: emailSendingDomains.dkimMode,
        dnsRecords: emailSendingDomains.dnsRecords,
      })
      .from(emailSendingDomains)
      .where(eq(emailSendingDomains.status, 'verified')),
    db
      .select({ name: ssoVerifiedDomain.name })
      .from(ssoVerifiedDomain)
      .where(isNotNull(ssoVerifiedDomain.verifiedAt)),
    db.select({ cloudIdentity: settings.cloudIdentity }).from(settings).limit(1),
  ])

  const zones: ProvenZone[] = []
  for (const row of sending) {
    if (sendingRowProvesZone(row)) {
      zones.push({ zone: toAsciiDomain(row.domain), source: 'email-sending', exact: false })
    }
  }
  for (const row of sso) {
    zones.push({ zone: toAsciiDomain(row.name), source: 'sso', exact: false })
  }
  const identity = parseIdentityProjection(settingsRows[0]?.cloudIdentity)
  for (const hostname of identity?.customDomains ?? []) {
    if (hostname.readiness === 'ready') {
      zones.push({ zone: toAsciiDomain(hostname.hostname), source: 'web-address', exact: true })
    }
  }
  return zones.filter((z) => z.zone !== '')
}

/**
 * The source that proves a single sign-on domain without its own TXT record:
 * any proof other than single sign-on itself. Null when none covers it.
 */
export async function ssoDomainProvenBy(name: string): Promise<ProvenZoneSource | null> {
  const zones = (await getProvenZones()).filter((z) => z.source !== 'sso')
  return provenZoneCovering(name, zones)?.source ?? null
}
