/**
 * The CNAME a self-hosted section hostname needs, shown under its row on the
 * Custom domains card until it is verified. Its own module, loaded only when a
 * record is awaited.
 */
import { DnsRecordTable, type DnsRecordRow } from '@/components/shared/dns-record-table'
import type { SectionDomain } from '@/lib/shared/section-domains'

/** What the last check found, from a self-hosted verify. */
export interface CheckResult {
  dnsResolved: boolean
  verified: boolean
}

/** The CNAME a self-hosted section hostname needs, with what its last check found. */
export function cnameRecord(
  entry: SectionDomain,
  target: string,
  check?: CheckResult
): DnsRecordRow {
  const record = { label: 'Routing', type: 'CNAME', name: entry.hostname, value: target }
  if (!check) return { ...record, state: 'waiting' }
  if (check.verified) return { ...record, state: 'found' }
  if (!check.dnsResolved) return { ...record, state: 'waiting' }
  return {
    ...record,
    state: 'problem',
    problem:
      'This name resolves but does not reach this server yet. Check the CNAME and your proxy.',
  }
}

export default function SectionDomainRecord({
  entry,
  target,
  check,
}: {
  entry: SectionDomain
  target: string
  check?: CheckResult
}) {
  return <DnsRecordTable records={[cnameRecord(entry, target, check)]} />
}
