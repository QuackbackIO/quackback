/**
 * The records for one sending domain, shown under the first address that uses
 * it: what to publish while it is being set up or needs fixing, and what to
 * keep in place once it is live.
 *
 * While records are still wanted it also says how many were found and where
 * the domain's DNS is managed when its nameservers say, each in one line, and
 * copies the records for whoever manages the DNS.
 */
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { DnsRecordTable } from '@/components/shared/dns-record-table'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { SendingRecordTable } from './dns-record-table'
import {
  dnsHostGuide,
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
  hideName = false,
}: {
  domain: SendingDomainDTO
  phase: DomainPhase
  onCheckAgain: () => void
  checking?: boolean
  /** On a page already titled with the domain: a verified panel does not name it again. */
  hideName?: boolean
}) {
  // Was live once and is not now: the records were there, so this is a fix.
  const broken = phase === 'attention' && domain.verifiedAt !== null
  const checked = lastCheckedAt(domain)
  const checkedAgo = checked ? formatDistanceToNow(checked, { addSuffix: true }) : null
  const checkedTitle = checkedAgo ? `Last checked ${checkedAgo}` : undefined
  // Said in the line while records are wanted: it is what a press of Check now changes.
  const lastChecked = checkedAgo ? ` Last checked ${checkedAgo}.` : ''
  const { found, total } = recordsFound(domain)
  const host = phase === 'live' ? null : dnsHostGuide(domain)

  return (
    <div
      data-slot="domain-setup-panel"
      className="space-y-3 border-t border-border/50 bg-muted/20 px-4 py-3 sm:px-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {!(hideName && phase === 'live') && (
          <h3 className="text-sm font-medium">
            {phase === 'live'
              ? domain.domain
              : broken
                ? `Fix ${domain.domain}`
                : `Set up ${domain.domain}`}
          </h3>
        )}
        {phase !== 'live' && total > 0 && (
          <p className="text-xs text-muted-foreground">
            {found} of {total} records found
          </p>
        )}
      </div>
      {host && (
        <p data-slot="dns-host" className="text-[13px] text-muted-foreground">
          Your DNS is at {host.name}.{host.tip ? ` ${host.tip}` : ''}
          {host.url && (
            <>
              {' '}
              <a
                href={host.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Open {host.name}
              </a>
            </>
          )}
        </p>
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
          title={phase === 'live' ? checkedTitle : undefined}
        >
          {phase === 'live'
            ? 'Keep these records in place.'
            : phase === 'setting-up'
              ? `We check automatically and will let you know when it's verified.${lastChecked}`
              : broken
                ? `We can't find these records any more.${lastChecked}`
                : `We haven't found these records yet.${lastChecked}`}
        </span>
        {phase !== 'live' && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={checking} onClick={onCheckAgain}>
              Check now
            </Button>
            <CopyInstructionsButton domain={domain} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A domain with no DMARC record still verifies, so this is one line beside the
 * records, not among them, and the record itself is one press away.
 */
function DmarcAdvisory({ domain }: { domain: SendingDomainDTO }) {
  const [shown, setShown] = useState(false)
  return (
    <div data-slot="dmarc-advisory" className="space-y-2">
      <p className="text-xs text-muted-foreground">
        No DMARC record on {zoneOf(domain)}. Optional, but Gmail and Yahoo expect one from anyone
        sending in bulk.{' '}
        <Button
          variant="link"
          size="sm"
          aria-expanded={shown}
          onClick={() => setShown((s) => !s)}
          className="h-auto p-0 text-xs font-medium text-foreground"
        >
          {shown ? 'Hide the record' : 'Show the record'}
        </Button>
      </p>
      {shown && (
        <DnsRecordTable records={[{ label: 'DMARC', state: 'waiting', ...SUGGESTED_DMARC }]} />
      )}
    </div>
  )
}

/** Copies the records as plain text, for whoever manages the domain's DNS. */
function CopyInstructionsButton({ domain }: { domain: SendingDomainDTO }) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <Button size="sm" variant="outline" onClick={() => copy(instructionsText(domain))}>
      {copied ? 'Copied' : 'Copy instructions'}
    </Button>
  )
}
