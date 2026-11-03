/**
 * What the email settings page says about a sending domain, derived from the
 * server's DTO in one place so the rows, the setup panel and the record table
 * agree.
 */
import type { DnsRecordDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'

/**
 * Where a domain stands, as a person sees it.
 *
 * - `live`: verified; addresses on it send as themselves.
 * - `setting-up`: pending inside its automatic check window.
 * - `not-found`: pending after the window ran out without the records.
 * - `attention`: was verified and stopped being, or the provider failed it.
 */
export type DomainPhase = 'live' | 'setting-up' | 'not-found' | 'attention'

export function domainPhase(domain: SendingDomainDTO, now: Date = new Date()): DomainPhase {
  if (domain.status === 'verified') return 'live'
  if (domain.status === 'failed' || domain.verifiedAt) return 'attention'
  const until = domain.autoCheckUntil ? new Date(domain.autoCheckUntil) : null
  return until && until > now ? 'setting-up' : 'not-found'
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
  dkim: 'signing record',
  'mail-from': 'return path record',
}

/** The kind of record a failing check is, in words, or null when all are found. */
export function failingRecordName(domain: SendingDomainDTO): string | null {
  const failing = domain.dnsRecords.find((r) => r.check && r.check.state !== 'found')
  return failing ? (PURPOSE_NAME[failing.purpose] ?? 'DNS record') : null
}

/** The display line for a record's type: an MX carries its priority. */
export function recordTypeLabel(record: Pick<DnsRecordDTO, 'type' | 'priority'>): string {
  return record.type === 'MX' && record.priority !== undefined
    ? `MX ${record.priority}`
    : record.type
}

/** The optional DMARC record, offered only when the domain has none. */
export const DMARC_SUGGESTION: DnsRecordDTO = {
  type: 'TXT',
  host: '_dmarc',
  value: 'v=DMARC1; p=none',
  purpose: 'dmarc',
}

/**
 * The records to publish, as plain text a person can paste into a ticket or
 * a message to whoever manages their DNS.
 */
export function instructionsText(domain: SendingDomainDTO): string {
  const records = [
    ...domain.dnsRecords,
    ...(domain.preflight.dmarc?.found === false ? [DMARC_SUGGESTION] : []),
  ]
  const lines = records.map(
    (r) =>
      `${recordTypeLabel(r)}  ${r.host}  ${r.value}${r.purpose === 'dmarc' ? '  (optional)' : ''}`
  )
  return [
    `Add these DNS records to ${domain.domain} so replies can be sent from it. Enter each name as shown; most DNS hosts add .${domain.domain} themselves.`,
    '',
    ...lines,
  ].join('\n')
}
