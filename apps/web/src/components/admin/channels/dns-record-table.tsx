/**
 * A sending domain's records in the shared record table, with what our last
 * lookup found for each.
 *
 * Names are relative to the domain, since most DNS hosts append it.
 */
import {
  DnsRecordTable,
  type DnsRecordRow,
  type DnsRecordState,
} from '@/components/shared/dns-record-table'
import type { DnsRecordDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { recordLabel, recordTypeLabel, signingMode, type DomainPhase } from './sending-domain-view'

/** A record's state and, when it needs fixing, the one sentence that says how. */
export function recordStatus(
  record: DnsRecordDTO,
  ctx: { domain: string; phase: DomainPhase }
): { state: DnsRecordState; fix?: string } {
  const check = record.check
  if (!check) return { state: 'waiting' }
  switch (check.state) {
    case 'found':
      return { state: 'found' }
    case 'proxied':
      return {
        state: 'problem',
        fix: 'This name returns an address instead of pointing to the value above. Turn off any proxy for it.',
      }
    case 'mismatch':
      if (check.reason === 'truncated') {
        return {
          state: 'problem',
          fix: 'Your DNS host cut this value short. Paste it again, or use Copy as parts.',
        }
      }
      if (check.reason === 'quoted') {
        return {
          state: 'problem',
          fix: 'Your DNS host saved the quote marks as part of this value. Paste it again without them.',
        }
      }
      return {
        state: 'problem',
        fix:
          check.reason === 'doubled-name'
            ? `The domain looks like it was entered twice. Use just the part before .${ctx.domain}.`
            : check.seen
              ? `This name has a different value: ${check.seen}. Replace it with the value above.`
              : 'This name has a different value. Replace it with the value above.',
      }
    case 'missing':
      return ctx.phase === 'setting-up'
        ? { state: 'waiting' }
        : {
            state: 'problem',
            fix: "We couldn't find this record. Add it with the name and value above.",
          }
  }
}

/** The records a sending domain needs, in the shared record table. */
export function SendingRecordTable({
  domain,
  phase,
}: {
  domain: SendingDomainDTO
  phase: DomainPhase
}) {
  return (
    <DnsRecordTable
      records={domain.dnsRecords.map((r): DnsRecordRow => {
        const status = recordStatus(r, { domain: domain.domain, phase })
        return {
          label: recordLabel(r, signingMode(domain)),
          type: recordTypeLabel(r),
          name: r.host,
          value: r.value,
          state: status.state,
          problem: status.fix,
        }
      })}
    />
  )
}
