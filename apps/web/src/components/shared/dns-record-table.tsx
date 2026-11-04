/**
 * DNS records someone has to publish, one row each, with what the last check
 * found shown as an icon. A record that needs fixing gets one sentence under it
 * saying what to do; nothing is said up front.
 *
 * Every page that asks for DNS records uses this table, so a person sees the
 * same columns, states and copy buttons wherever they start.
 */
import { Fragment } from 'react'
import { CheckCircleIcon, ClockIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { CopyButton } from '@/components/shared/copy-button'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/shared/utils'

export type DnsRecordState = 'found' | 'waiting' | 'problem'

/**
 * For a table whose names are full hostnames because the zone they sit in is
 * not known (most callers pass names relative to the domain, `@` for its apex).
 */
export const FULL_NAMES_NOTE =
  'Names are shown in full. If your DNS host adds your domain itself, enter only the part before it.'

export interface DnsRecordRow {
  /** What the record is for, in a word or two. */
  label: string
  /** The record type as shown, such as `CNAME`, `TXT` or `MX 10`. */
  type: string
  /** Relative to the domain (`@` for its apex), unless the caller says otherwise. */
  name: string
  value: string
  state: DnsRecordState
  /** The sentence that says how to fix it, for a record in the problem state. */
  problem?: string
}

/** The most characters one TXT string holds; a longer value is several strings of one record. */
const TXT_STRING_MAX = 255

/**
 * A value as quoted parts of at most 255 characters each, `"<part>" "<rest>"`:
 * the form DNS hosts that do not split a long TXT value themselves expect.
 */
export function txtParts(value: string): string {
  const parts: string[] = []
  for (let i = 0; i < value.length; i += TXT_STRING_MAX) {
    parts.push(`"${value.slice(i, i + TXT_STRING_MAX)}"`)
  }
  return parts.join(' ')
}

function CopyAsParts({ value, name }: { value: string; name: string }) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      onClick={() => copy(txtParts(value))}
      className="h-auto p-0 text-xs font-normal text-muted-foreground"
      aria-label={`Copy as parts for ${name}`}
    >
      {copied ? 'Copied' : 'Copy as parts'}
    </Button>
  )
}

const STATE_ICON = {
  found: { icon: CheckCircleIcon, label: 'Found', tone: 'text-success' },
  waiting: { icon: ClockIcon, label: 'Waiting', tone: 'text-muted-foreground/70' },
  problem: { icon: ExclamationCircleIcon, label: 'Needs a fix', tone: 'text-destructive' },
} as const

export function DnsRecordTable({ records }: { records: DnsRecordRow[] }) {
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
          {records.map((r) => {
            const { icon: Icon, label, tone } = STATE_ICON[r.state]
            return (
              <Fragment key={`${r.type} ${r.name} ${r.value}`}>
                <tr data-slot="dns-record" className="border-t border-border/50 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <Icon className={cn('size-4 shrink-0', tone)} aria-hidden="true" />
                      <span className="sr-only">{label}: </span>
                      {r.label}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="flex items-start gap-1">
                      <span className="font-mono whitespace-nowrap">{r.name}</span>
                      <CopyButton
                        value={r.name}
                        variant="ghost"
                        className="size-6"
                        aria-label={`Copy name ${r.name}`}
                      />
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{r.type}</td>
                  <td className="py-1.5">
                    <span className="flex items-start gap-1">
                      <span className="font-mono break-all">{r.value}</span>
                      <CopyButton
                        value={r.value}
                        variant="ghost"
                        className="size-6"
                        aria-label={`Copy value for ${r.name}`}
                      />
                    </span>
                  </td>
                </tr>
                {r.value.length > TXT_STRING_MAX && (
                  <tr data-slot="dns-record-parts">
                    <td colSpan={3} />
                    <td className="pb-1.5">
                      <CopyAsParts value={r.value} name={r.name} />
                    </td>
                  </tr>
                )}
                {r.state === 'problem' && r.problem && (
                  <tr data-slot="dns-record-fix">
                    <td colSpan={4} className="pb-2 text-xs text-destructive break-all">
                      {r.problem}
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
