/**
 * The proof sent with an operator-managed hostname (a web address) when this
 * workspace already proved a zone that covers it, so the operator can accept
 * the hostname without a challenge record of its own.
 *
 * Only a zone at or above the hostname counts, never one under it, and never
 * a web address: that is the thing being proven.
 */
import { toAsciiDomain, isAtOrUnder } from '@/lib/server/domains/channel-accounts/outbound-identity'
import { getProvenZones, type ProvenZone } from './proven-zones'

export type HostnameProofSource = 'email-sending' | 'sso'

export interface HostnameProof {
  source: HostnameProofSource
  /** The proven zone, in its ASCII spelling, lower case, with no trailing dot. */
  zone: string
  /** The TXT record that proves the zone: a full name and its exact value. */
  record: { name: string; value: string }
}

/** Where a source ranks among proofs of the same zone. */
const SOURCE_RANK: Record<HostnameProofSource, number> = { 'email-sending': 0, sso: 1 }

function labelCount(zone: string): number {
  return zone.split('.').length
}

/**
 * The proof for `hostname` among `zones`, or null when none covers it.
 *
 * Chosen the same way every time: the most specific zone first, then email
 * sending over single sign-on, then by record name.
 */
export function hostnameProofFrom(
  hostname: string,
  zones: readonly ProvenZone[]
): HostnameProof | null {
  const name = toAsciiDomain(hostname)
  if (!name) return null
  const candidates: HostnameProof[] = []
  for (const z of zones) {
    if (z.source === 'web-address' || z.exact || !z.record) continue
    if (!isAtOrUnder(name, z.zone)) continue
    candidates.push({ source: z.source, zone: z.zone, record: z.record })
  }
  candidates.sort(
    (a, b) =>
      labelCount(b.zone) - labelCount(a.zone) ||
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      a.record.name.localeCompare(b.record.name)
  )
  return candidates[0] ?? null
}

/**
 * Reads this workspace's proven zones once, from its own database, and
 * answers for any number of hostnames.
 */
export async function readHostnameProofs(): Promise<(hostname: string) => HostnameProof | null> {
  const zones = await getProvenZones({ includeSso: true })
  return (hostname) => hostnameProofFrom(hostname, zones)
}

/** The proof this workspace holds for `hostname`. */
export async function getHostnameProof(hostname: string): Promise<HostnameProof | null> {
  return (await readHostnameProofs())(hostname)
}
