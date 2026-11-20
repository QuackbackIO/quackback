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

/**
 * The sources the operator accepts as a hostname's `ownershipSource`, and so
 * the only ones ever sent.
 *
 * A domain added by name (`domain`) is ranked below but not sent: the
 * operator's `ownershipSource` does not know it yet, and a proof is never sent
 * under a source other than the one that proved it, so relabelling it as
 * `email-sending` is not an option. To turn it on once the operator accepts
 * it, add `'domain'` to this union and to {@link SENT_SOURCES}.
 */
export type HostnameProofSource = 'email-sending' | 'sso'

/** Every source a hostname proof can come from, sent or not. */
export type RankedProofSource = HostnameProofSource | 'domain'

/** The gate: the sources {@link hostnameProofFrom} may return. */
const SENT_SOURCES: readonly RankedProofSource[] = [
  'email-sending',
  'sso',
] satisfies readonly HostnameProofSource[]

function isSentSource(source: RankedProofSource): source is HostnameProofSource {
  return SENT_SOURCES.includes(source)
}

export interface HostnameProof {
  source: HostnameProofSource
  /** The proven zone, in its ASCII spelling, lower case, with no trailing dot. */
  zone: string
  /** The TXT record that proves the zone: a full name and its exact value. */
  record: { name: string; value: string }
}

/** A candidate proof, which may come from a source that is not sent. */
export interface RankedZoneProof extends Omit<HostnameProof, 'source'> {
  source: RankedProofSource
}

/** Where a source ranks among proofs of the same zone. */
const SOURCE_RANK: Record<RankedProofSource, number> = {
  'email-sending': 0,
  sso: 1,
  domain: 2,
}

function labelCount(zone: string): number {
  return zone.split('.').length
}

/**
 * Every proof among `zones` that covers `hostname`, best first: the most
 * specific zone, then email sending, single sign-on, a domain added by name,
 * then by record name. Includes sources that are not sent.
 */
export function rankedZoneProofs(
  hostname: string,
  zones: readonly ProvenZone[]
): RankedZoneProof[] {
  const name = toAsciiDomain(hostname)
  if (!name) return []
  const candidates: RankedZoneProof[] = []
  for (const z of zones) {
    if (z.source === 'web-address' || z.exact || !z.record) continue
    if (!isAtOrUnder(name, z.zone)) continue
    candidates.push({ source: z.source, zone: z.zone, record: z.record })
  }
  return candidates.sort(
    (a, b) =>
      labelCount(b.zone) - labelCount(a.zone) ||
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      a.record.name.localeCompare(b.record.name)
  )
}

/**
 * The proof for `hostname` among `zones`, or null when none the operator
 * accepts covers it. The best ranked proof from a sent source, carrying the
 * source that proved it.
 */
export function hostnameProofFrom(
  hostname: string,
  zones: readonly ProvenZone[]
): HostnameProof | null {
  for (const candidate of rankedZoneProofs(hostname, zones)) {
    const { source } = candidate
    if (isSentSource(source)) return { ...candidate, source }
  }
  return null
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
