/**
 * What the email settings page says about a sending domain, derived from the
 * server's DTO in one place so the rows, the setup panel and the record table
 * agree.
 */
import type { DnsRecordDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { nameInZone, recordZone } from '@/lib/shared/record-zone'

/**
 * Where a domain stands, as a person sees it.
 *
 * - `live`: verified; addresses on it send as themselves.
 * - `setting-up`: pending inside its automatic check window.
 * - `not-found`: pending after the window ran out without the records.
 *   A pending domain with no window yet counts as setting up.
 * - `attention`: was verified and stopped being, or the provider failed it.
 */
export type DomainPhase = 'live' | 'setting-up' | 'not-found' | 'attention'

export function domainPhase(
  domain: Pick<SendingDomainDTO, 'status' | 'verifiedAt' | 'autoCheckUntil'>,
  now: Date = new Date()
): DomainPhase {
  if (domain.status === 'verified') return 'live'
  if (domain.status === 'failed' || domain.verifiedAt) return 'attention'
  // No window at all is a domain from before windows existed that the
  // migration has not reached yet: still being set up, not overdue.
  if (!domain.autoCheckUntil) return 'setting-up'
  return new Date(domain.autoCheckUntil) > now ? 'setting-up' : 'not-found'
}

/** The latest of the domain's own record lookups, or null before the first. */
export function lastCheckedAt(domain: SendingDomainDTO): Date | null {
  let latest: number | null = null
  for (const r of domain.dnsRecords) {
    const at = r.check ? Date.parse(r.check.checkedAt) : NaN
    if (!Number.isNaN(at) && (latest === null || at > latest)) latest = at
  }
  return latest === null ? null : new Date(latest)
}

const PURPOSE_NAME: Record<string, string> = {
  ownership: 'ownership record',
  dkim: 'DKIM record',
  'mail-from': 'return path record',
}

/** The kind of record a failing check is, in words, or null when all are found. */
export function failingRecordName(domain: SendingDomainDTO): string | null {
  const failing = domain.dnsRecords.find((r) => r.check && r.check.state !== 'found')
  return failing ? (PURPOSE_NAME[failing.purpose] ?? 'DNS record') : null
}

/**
 * Whether a record proves this domain's ownership: the ownership TXT, or on a
 * domain with a key TXT of its own, that key.
 */
export function provesOwnership(
  domain: Pick<SendingDomainDTO, 'dkimMode'>,
  record: Pick<DnsRecordDTO, 'purpose' | 'type'>
): boolean {
  return (
    record.purpose === 'ownership' ||
    (domain.dkimMode !== 'easy' && record.purpose === 'dkim' && record.type === 'TXT')
  )
}

/**
 * The line for a live domain whose ownership record has gone missing: the
 * date it has to be back by. Null when the record is in place.
 */
export function ownershipWarning(
  domain: Pick<SendingDomainDTO, 'domain' | 'ownershipDeadline'>
): string | null {
  if (!domain.ownershipDeadline) return null
  const by = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(domain.ownershipDeadline)
  )
  return `Add this record back by ${by} to keep sending from ${domain.domain}.`
}

/** The display line for a record's type: an MX carries its priority. */
export function recordTypeLabel(record: Pick<DnsRecordDTO, 'type' | 'priority'>): string {
  return record.type === 'MX' && record.priority !== undefined
    ? `MX ${record.priority}`
    : record.type
}

const RECORD_LABEL: Record<string, string> = {
  ownership: 'Ownership',
  dkim: 'DKIM',
  'mail-from': 'Return path',
}

/**
 * How a domain's records sign: a `shared` domain waiting to re-key its
 * identity to the row's own key reads as `byo`, since that key is the one
 * that will sign.
 */
export function signingMode(
  domain: Pick<SendingDomainDTO, 'dkimMode' | 'signingKeyPending'>
): SendingDomainDTO['dkimMode'] {
  return domain.signingKeyPending ? 'byo' : domain.dkimMode
}

/**
 * The short label for what a record does. On a `shared` domain the row's own
 * key TXT signs nothing (the identity keeps its key) and only proves ownership.
 */
export function recordLabel(
  record: Pick<DnsRecordDTO, 'purpose' | 'type'>,
  dkimMode?: SendingDomainDTO['dkimMode']
): string {
  if (dkimMode === 'shared' && record.purpose === 'dkim' && record.type === 'TXT') {
    return 'Ownership'
  }
  return RECORD_LABEL[record.purpose] ?? record.purpose
}

/** Whether a shared domain signs with a key none of its listed records carry. */
export function signsWithUnlistedKey(domain: SendingDomainDTO): boolean {
  return (
    signingMode(domain) === 'shared' &&
    !domain.dnsRecords.some((r) => r.purpose === 'dkim' && r.type === 'CNAME')
  )
}

/**
 * Whether a domain that should be live is held up by its signing key rather
 * than a record: every listed record is found, yet it is not live.
 */
export function signingKeyFailing(domain: SendingDomainDTO, phase: DomainPhase): boolean {
  if (phase !== 'not-found' && phase !== 'attention') return false
  const records = domain.dnsRecords
  return records.length > 0 && records.every((r) => r.check?.state === 'found')
}

/** The sentence for a signing key that is not working. */
export const signingKeyProblem = (domain: string) => `The signing key for ${domain} isn't working.`

/** The zone a domain's records are typed into: the domain, or the parent that holds it. */
export const zoneOf = (domain: Pick<SendingDomainDTO, 'domain' | 'preflight'>): string =>
  recordZone(domain.domain, domain.preflight.zone)

/** A record's name as that zone's DNS form expects it. */
export const recordName = (
  record: Pick<DnsRecordDTO, 'host'>,
  domain: Pick<SendingDomainDTO, 'domain' | 'preflight'>
): string => nameInZone(record.host, domain.domain, domain.preflight.zone)

/** How many of a domain's records the last check found. */
export function recordsFound(domain: Pick<SendingDomainDTO, 'dnsRecords'>): {
  found: number
  total: number
} {
  return {
    found: domain.dnsRecords.filter((r) => r.check?.state === 'found').length,
    total: domain.dnsRecords.length,
  }
}

type KnownDnsHost = Exclude<NonNullable<SendingDomainDTO['preflight']['dnsHost']>, 'other'>

/** The DNS hosts told apart by their nameservers, and where each lists a domain's records. */
const DNS_HOSTS: Record<KnownDnsHost, { name: string; url?: string }> = {
  cloudflare: {
    name: 'Cloudflare',
    url: 'https://dash.cloudflare.com/?to=/:account/:zone/dns/records',
  },
  route53: {
    name: 'Amazon Route 53',
    url: 'https://console.aws.amazon.com/route53/v2/hostedzones',
  },
  godaddy: { name: 'GoDaddy', url: 'https://dcc.godaddy.com/control/portfolio' },
  namecheap: { name: 'Namecheap', url: 'https://ap.www.namecheap.com/domains/list/' },
  // These nameservers serve more than one product, so there is no one place to send someone.
  google: { name: 'Google' },
}

/**
 * Where a domain's DNS is managed, when its nameservers say, with the one
 * thing worth knowing about adding these records there. Null for a host we do
 * not recognise: nothing is better than a guess.
 */
export function dnsHostGuide(
  domain: Pick<SendingDomainDTO, 'domain' | 'dnsRecords' | 'preflight'>
): { name: string; tip: string | null; url: string | null } | null {
  const host = domain.preflight.dnsHost
  if (!host || host === 'other') return null
  const { name, url } = DNS_HOSTS[host]
  // The one host with a setting that breaks these records when left on.
  const proxies = host === 'cloudflare' && domain.dnsRecords.some((r) => r.type === 'CNAME')
  const tip = proxies ? 'Add each CNAME as DNS only, not proxied.' : null
  return { name, tip, url: url ?? null }
}

/** Whether the last look found no DMARC record covering the domain. */
export const lacksDmarc = (domain: Pick<SendingDomainDTO, 'preflight'>): boolean =>
  domain.preflight.dmarc?.found === false

/**
 * The DMARC record to suggest to a domain that has none: the least a receiver
 * asks for, which reports and changes nothing about delivery.
 */
export const SUGGESTED_DMARC = { name: '_dmarc', type: 'TXT', value: 'v=DMARC1; p=none' } as const

/**
 * The records to publish, as plain text a person can paste into a ticket or
 * a message to whoever manages their DNS.
 */
export function instructionsText(domain: SendingDomainDTO): string {
  const zone = zoneOf(domain)
  const lines = domain.dnsRecords.map(
    (r) => `${recordTypeLabel(r)}  ${recordName(r, domain)}  ${r.value}`
  )
  const where =
    zone === domain.domain
      ? `Add these DNS records to ${domain.domain} so email can be sent from it.`
      : `Add these DNS records to ${zone} so email can be sent from ${domain.domain}.`
  return [
    `${where} Enter each name as shown; most DNS hosts add .${zone} themselves.`,
    '',
    ...lines,
  ].join('\n')
}

/**
 * What adding an address does about its domain, as the server will decide it:
 * a verified domain at or above it lets it send at once; this workspace's row
 * for that exact domain is reused in whatever state; anything else is new and
 * brings its DNS records. Null until the address names a domain.
 */
export function addressDomainStanding(
  address: string,
  domains: Pick<SendingDomainDTO, 'domain' | 'status' | 'verifiedAt' | 'autoCheckUntil'>[],
  now: Date = new Date()
): { kind: 'verified' | 'pending' | 'attention' | 'new'; domain: string } | null {
  const parts = address.trim().toLowerCase().split('@')
  const host = parts.length === 2 && parts[0] ? parts[1] : ''
  if (!/^[^\s.]+(\.[^\s.]+)*\.[^\s.]{2,}$/.test(host)) return null
  const covering = domains.find(
    (d) => d.status === 'verified' && (host === d.domain || host.endsWith(`.${d.domain}`))
  )
  if (covering) return { kind: 'verified', domain: covering.domain }
  const same = domains.find((d) => d.domain === host)
  if (!same) return { kind: 'new', domain: host }
  return { kind: domainPhase(same, now) === 'attention' ? 'attention' : 'pending', domain: host }
}
