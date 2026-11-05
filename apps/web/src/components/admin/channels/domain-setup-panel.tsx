/**
 * The records for one sending domain, shown under the first address that uses
 * it: what to publish while it is being set up or needs fixing, and what to
 * keep in place once it is live.
 */
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { SendingRecordTable } from './dns-record-table'
import {
  instructionsText,
  lastCheckedAt,
  signingKeyFailing,
  signingKeyProblem,
  signsWithUnlistedKey,
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
  const checkedTitle = checked
    ? `Last checked ${formatDistanceToNow(checked, { addSuffix: true })}`
    : undefined

  return (
    <div
      data-slot="domain-setup-panel"
      className="space-y-3 border-t border-border/50 bg-muted/20 px-4 py-3 sm:px-6"
    >
      <h3 className="text-sm font-medium">
        {phase === 'live'
          ? domain.domain
          : broken
            ? `Fix ${domain.domain}`
            : `Set up ${domain.domain}`}
      </h3>
      <SendingRecordTable domain={domain} phase={phase} />
      {signsWithUnlistedKey(domain) && (
        <p className="text-xs text-muted-foreground">
          Signing uses a key already set up for {domain.domain}.
        </p>
      )}
      {signingKeyFailing(domain, phase) && (
        <p className="text-xs text-destructive">{signingKeyProblem(domain.domain)}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="mr-auto" title={checkedTitle}>
          {phase === 'live'
            ? 'Keep these published.'
            : phase === 'setting-up'
              ? "Checking automatically. We'll let you know when it's live."
              : broken
                ? "We can't find these records any more."
                : "We couldn't find these records yet."}
        </span>
        {(phase === 'not-found' || phase === 'attention') && (
          <Button size="sm" variant="outline" disabled={checking} onClick={onCheckAgain}>
            Verify
          </Button>
        )}
        {phase !== 'live' && <CopyInstructionsButton domain={domain} />}
      </div>
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
