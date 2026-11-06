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

/**
 * The records to publish, as plain text a person can paste into a ticket or
 * a message to whoever manages their DNS.
 */
export function instructionsText(domain: SendingDomainDTO): string {
  const lines = domain.dnsRecords.map((r) => `${recordTypeLabel(r)}  ${r.host}  ${r.value}`)
  return [
    `Add these DNS records to ${domain.domain} so replies can be sent from it. Enter each name as shown; most DNS hosts add .${domain.domain} themselves.`,
    '',
    ...lines,
  ].join('\n')
}
