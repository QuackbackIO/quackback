/**
 * The DNS records a sending domain needs, grouped by what each one does, with
 * what our last lookup found for each.
 *
 * Names are shown relative to the domain, with the domain itself muted beside
 * them: most DNS hosts append it, so the part to copy is the short one.
 */
import { Fragment } from 'react'
import { CopyButton } from '@/components/shared/copy-button'
import type { DnsRecordDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { cn } from '@/lib/shared/utils'
import { DMARC_SUGGESTION, recordTypeLabel, type DomainPhase } from './sending-domain-view'

const GROUPS: { purpose: string; label: string; note?: string }[] = [
  { purpose: 'ownership', label: 'Ownership' },
  { purpose: 'dkim', label: 'Signing (DKIM)' },
  { purpose: 'mail-from', label: 'Return path' },
  { purpose: 'dmarc', label: 'DMARC', note: 'optional' },
]

type Tone = 'ok' | 'wait' | 'bad'

/** A record's status line and, when there is more to say, the detail under it. */
export function recordStatus(
  record: DnsRecordDTO,
  ctx: { domain: string; phase: DomainPhase; allFound: boolean }
): { label: string; tone: Tone; detail?: string } {
  if (record.purpose === 'dmarc') return { label: 'Optional', tone: 'wait' }
  const check = record.check
  if (!check) return { label: 'Waiting', tone: 'wait' }
  switch (check.state) {
    case 'found':
      return ctx.phase === 'setting-up' && ctx.allFound
        ? { label: 'Found, waiting for confirmation', tone: 'ok' }
        : { label: 'Found', tone: 'ok' }
    case 'proxied':
      return {
        label: 'Proxied',
        tone: 'bad',
        detail:
          'This name returns an address instead of pointing to the value above. Turn off any proxy for it.',
      }
    case 'mismatch':
      return {
        label: 'Wrong value',
        tone: 'bad',
        detail:
          check.reason === 'doubled-name'
            ? `The domain looks like it was entered twice. Use just the part before .${ctx.domain}.`
            : check.seen
              ? `Found ${check.seen}`
              : undefined,
      }
    case 'missing':
      return ctx.phase === 'setting-up'
        ? { label: 'Waiting', tone: 'wait' }
        : { label: 'Missing', tone: 'bad' }
  }
}

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-success',
  wait: 'text-muted-foreground',
  bad: 'text-destructive',
}

export function DnsRecordTable({
  domain,
  phase,
}: {
  domain: SendingDomainDTO
  phase: DomainPhase
}) {
  const records = [
    ...domain.dnsRecords,
    ...(domain.preflight.dmarc?.found === false ? [DMARC_SUGGESTION] : []),
  ]
  const required = domain.dnsRecords
  const allFound = required.length > 0 && required.every((r) => r.check?.state === 'found')
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">Type</th>
            <th className="py-1.5 pr-3 font-medium">Name</th>
            <th className="py-1.5 pr-3 font-medium">Value</th>
            <th className="py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((group) => {
            const rows = records.filter((r) => r.purpose === group.purpose)
            if (rows.length === 0) return null
            return (
              <Fragment key={group.purpose}>
                <tr>
                  <th
                    colSpan={4}
                    scope="colgroup"
                    className="pt-3 pb-1 text-left text-xs font-medium text-foreground"
                  >
                    {group.label}
                    {group.note && (
                      <span className="ml-1.5 font-normal text-muted-foreground">{group.note}</span>
                    )}
                  </th>
                </tr>
                {rows.map((r) => {
                  const status = recordStatus(r, { domain: domain.domain, phase, allFound })
                  return (
                    <tr
                      key={`${r.type} ${r.host} ${r.value}`}
                      data-slot="dns-record"
                      className="border-t border-border/50 align-top"
                    >
                      <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                        {recordTypeLabel(r)}
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-start gap-1">
                          <span className="font-mono break-all">
                            {r.host}
                            <span className="text-muted-foreground">.{domain.domain}</span>
                          </span>
                          <CopyButton
                            value={r.host}
                            variant="ghost"
                            className="size-6"
                            aria-label={`Copy name ${r.host}`}
                          />
                        </div>
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-start gap-1">
                          <span className="font-mono break-all">{r.value}</span>
                          <CopyButton
                            value={r.value}
                            variant="ghost"
                            className="size-6"
                            aria-label={`Copy value for ${r.host}`}
                          />
                        </div>
                      </td>
                      <td className="py-1.5 min-w-32">
                        <span className={cn('font-medium', TONE_CLASS[status.tone])}>
                          {status.label}
                        </span>
                        {status.detail && (
                          <span className="mt-0.5 block text-xs text-muted-foreground break-all">
                            {status.detail}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
