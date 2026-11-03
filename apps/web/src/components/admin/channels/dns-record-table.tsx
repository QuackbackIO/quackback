/**
 * The DNS records a sending domain needs, one row each, with what our last
 * lookup found shown as an icon. A record that needs fixing gets one sentence
 * under it saying what to do; nothing is said up front.
 *
 * Names are relative to the domain, since most DNS hosts append it.
 */
import { Fragment } from 'react'
import { CheckCircleIcon, ClockIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { CopyButton } from '@/components/shared/copy-button'
import type { DnsRecordDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { cn } from '@/lib/shared/utils'
import { recordLabel, recordTypeLabel, type DomainPhase } from './sending-domain-view'

type RecordState = 'found' | 'waiting' | 'problem'

/** A record's state and, when it needs fixing, the one sentence that says how. */
export function recordStatus(
  record: DnsRecordDTO,
  ctx: { domain: string; phase: DomainPhase }
): { state: RecordState; fix?: string } {
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

const STATE_ICON = {
  found: { icon: CheckCircleIcon, label: 'Found', tone: 'text-success' },
  waiting: { icon: ClockIcon, label: 'Waiting', tone: 'text-muted-foreground/70' },
  problem: { icon: ExclamationCircleIcon, label: 'Needs a fix', tone: 'text-destructive' },
} as const

export function DnsRecordTable({
  domain,
  phase,
}: {
  domain: SendingDomainDTO
  phase: DomainPhase
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">Record</th>
            <th className="py-1.5 pr-3 font-medium">Name</th>
            <th className="py-1.5 pr-3 font-medium">Type</th>
            <th className="py-1.5 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {domain.dnsRecords.map((r) => {
            const status = recordStatus(r, { domain: domain.domain, phase })
            const { icon: Icon, label, tone } = STATE_ICON[status.state]
            return (
              <Fragment key={`${r.type} ${r.host} ${r.value}`}>
                <tr data-slot="dns-record" className="border-t border-border/50 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <Icon className={cn('size-4 shrink-0', tone)} aria-hidden="true" />
                      <span className="sr-only">{label}: </span>
                      {recordLabel(r)}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="flex items-start gap-1">
                      <span className="font-mono break-all">{r.host}</span>
                      <CopyButton
                        value={r.host}
                        variant="ghost"
                        className="size-6"
                        aria-label={`Copy name ${r.host}`}
                      />
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{recordTypeLabel(r)}</td>
                  <td className="py-1.5">
                    <span className="flex items-start gap-1">
                      <span className="font-mono break-all">{r.value}</span>
                      <CopyButton
                        value={r.value}
                        variant="ghost"
                        className="size-6"
                        aria-label={`Copy value for ${r.host}`}
                      />
                    </span>
                  </td>
                </tr>
                {status.fix && (
                  <tr data-slot="dns-record-fix">
                    <td colSpan={4} className="pb-2 text-xs text-destructive break-all">
                      {status.fix}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
