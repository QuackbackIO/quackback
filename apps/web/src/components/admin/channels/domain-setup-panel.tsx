/**
 * The records for one sending domain, shown under the first address that uses
 * it: what to publish while it is being set up or needs fixing, and what to
 * keep in place once it is live.
 *
 * While records are still wanted it also says how many were found, where the
 * domain's DNS is managed when its nameservers say, and offers the records in
 * a form to pass on, since the person setting this up often does not manage
 * the DNS themselves.
 */
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ArrowTopRightOnSquareIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { DnsRecordTable } from '@/components/shared/dns-record-table'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { SendingRecordTable } from './dns-record-table'
import {
  dnsHostGuide,
  instructionsMailto,
  instructionsText,
  lacksDmarc,
  lastCheckedAt,
  recordsFound,
  signingKeyFailing,
  signingKeyProblem,
  signsWithUnlistedKey,
  SUGGESTED_DMARC,
  zoneOf,
  type DomainPhase,
} from './sending-domain-view'

export function DomainSetupPanel({
  domain,
  phase,
  onCheckAgain,
  checking = false,
}: {
  domain: SendingDomainDTO
  phase: DomainPhase
  onCheckAgain: () => void
  checking?: boolean
}) {
  // Was live once and is not now: the records were there, so this is a fix.
  const broken = phase === 'attention' && domain.verifiedAt !== null
  const checked = lastCheckedAt(domain)
  const checkedAgo = checked ? formatDistanceToNow(checked, { addSuffix: true }) : null
  const checkedTitle = checkedAgo ? `Last checked ${checkedAgo}` : undefined
  const { found, total } = recordsFound(domain)
  const host = phase === 'live' ? null : dnsHostGuide(domain)

  return (
    <div
      data-slot="domain-setup-panel"
      className="space-y-3 border-t border-border/50 bg-muted/20 px-4 py-3 sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium">
          {phase === 'live'
            ? domain.domain
            : broken
              ? `Fix ${domain.domain}`
              : `Set up ${domain.domain}`}
        </h3>
        {phase !== 'live' && total > 0 && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {found} of {total} records found
            <span
              aria-hidden="true"
              className="block h-1.5 w-24 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full bg-success transition-all duration-300"
                style={{ width: `${(found / total) * 100}%` }}
              />
            </span>
          </p>
        )}
      </div>
      {host && (
        <div
          data-slot="dns-host"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-field border border-border/60 bg-card px-3 py-2"
        >
          <p className="min-w-48 flex-1 text-[13px]">
            Your DNS is at {host.name}.{host.tip ? ` ${host.tip}` : ''}
          </p>
          {host.url && (
            <Button size="sm" variant="outline" asChild>
              <a href={host.url} target="_blank" rel="noreferrer">
                Open {host.name}
                <ArrowTopRightOnSquareIcon className="size-3.5" aria-hidden="true" />
              </a>
            </Button>
          )}
        </div>
      )}
      <SendingRecordTable domain={domain} phase={phase} />
      {signsWithUnlistedKey(domain) && (
        <p className="text-xs text-muted-foreground">
          Signing uses a key already set up for {domain.domain}.
        </p>
      )}
      {signingKeyFailing(domain, phase) && (
        <p className="text-xs text-destructive">{signingKeyProblem(domain.domain)}</p>
      )}
      {lacksDmarc(domain) && <DmarcAdvisory domain={domain} />}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {/* While it is being set up, when it was last looked at is said in the
            line itself: it is what changes when someone presses Check now. The
            line wraps within its own space, so the actions stay side by side. */}
        <span
          className="mr-auto min-w-48 flex-1"
          title={phase === 'setting-up' ? undefined : checkedTitle}
        >
          {phase === 'live'
            ? 'Keep these records in place.'
            : phase === 'setting-up'
              ? `We check automatically and will let you know when it's verified.${checkedAgo ? ` Last checked ${checkedAgo}.` : ''}`
              : broken
                ? "We can't find these records any more."
                : "We haven't found these records yet."}
        </span>
        {phase !== 'live' && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={checking} onClick={onCheckAgain}>
              Check now
            </Button>
            <SendInstructionsMenu domain={domain} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A domain with no DMARC record still verifies, so this is said beside the
 * records, not among them, and the record itself is one press away.
 */
function DmarcAdvisory({ domain }: { domain: SendingDomainDTO }) {
  const [shown, setShown] = useState(false)
  return (
    <div
      data-slot="dmarc-advisory"
      className="rounded-field border border-dashed border-border px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-48 flex-1">
          <p className="text-[13px] font-medium">No DMARC record on {zoneOf(domain)}</p>
          <p className="text-xs text-muted-foreground">
            Optional, but Gmail and Yahoo expect one from anyone sending in bulk.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide the record' : 'Show the record'}
        </Button>
      </div>
      {shown && (
        <div className="mt-2">
          <DnsRecordTable records={[{ label: 'DMARC', state: 'waiting', ...SUGGESTED_DMARC }]} />
        </div>
      )}
    </div>
  )
}

/** The records in a form to pass on: copied as plain text, or in a new email. */
function SendInstructionsMenu({ domain }: { domain: SendingDomainDTO }) {
  const { copy } = useCopyToClipboard()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
        Send to whoever manages DNS
        <ChevronDownIcon className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={async () => {
            if (await copy(instructionsText(domain))) toast.success('Instructions copied')
          }}
        >
          Copy instructions
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={instructionsMailto(domain)}>Write an email</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
