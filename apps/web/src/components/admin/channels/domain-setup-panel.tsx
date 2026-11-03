/**
 * The records for one sending domain, shown under the first address that uses
 * it: how to publish them while the domain is being set up, what went missing
 * when it needs attention, and what to keep in place once it is live.
 */
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/client/hooks/use-copy-to-clipboard'
import type { SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { DnsRecordTable } from './dns-record-table'
import { instructionsText, lastCheckedAt, type DomainPhase } from './sending-domain-view'

const DNS_HOST_NAME: Record<string, string> = {
  cloudflare: 'Cloudflare',
  route53: 'Route 53',
  godaddy: 'GoDaddy',
  namecheap: 'Namecheap',
  google: 'Google',
}

function hostTip(domain: SendingDomainDTO): string {
  return domain.preflight.dnsHost === 'cloudflare'
    ? `Cloudflare: set the three _domainkey records to DNS only. Enter names without .${domain.domain}; Cloudflare adds it.`
    : `Enter names without .${domain.domain}; most DNS hosts add it.`
}

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
  const checked = lastCheckedAt(domain)
  const lastChecked = checked
    ? `last checked ${formatDistanceToNow(checked, { addSuffix: true })}`
    : 'not checked yet'
  const host = domain.preflight.dnsHost ? DNS_HOST_NAME[domain.preflight.dnsHost] : undefined
  const settingUp = phase === 'setting-up' || phase === 'not-found'

  return (
    <div
      data-slot="domain-setup-panel"
      className="space-y-3 border-t border-border/50 bg-muted/20 px-4 py-3 sm:px-6"
    >
      {settingUp ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-sm font-medium">Set up {domain.domain}</h3>
            {host && (
              <Badge size="sm" variant="secondary">
                DNS: {host}
              </Badge>
            )}
            {domain.preflight.mailFromFree && (
              <Badge size="sm" variant="secondary">
                {domain.mailFromLabel}.{domain.domain} is free
              </Badge>
            )}
            {domain.preflight.dmarc?.found && (
              <Badge size="sm" variant="secondary">
                DMARC found
              </Badge>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground">{hostTip(domain)}</p>
        </>
      ) : phase === 'live' ? (
        <p className="text-[13px] text-muted-foreground">
          Keep these published. They&apos;re checked daily.
        </p>
      ) : null}

      <DnsRecordTable domain={domain} phase={phase} />

      {phase !== 'live' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="mr-auto">
            {phase === 'setting-up'
              ? `Checking automatically for 72 hours · ${lastChecked}`
              : `Checked daily · ${lastChecked}`}
          </span>
          {phase !== 'setting-up' && (
            <Button size="sm" variant="outline" disabled={checking} onClick={onCheckAgain}>
              Check again
            </Button>
          )}
          <CopyInstructionsButton domain={domain} />
        </div>
      )}
    </div>
  )
}

/** Copies the records as plain text, for whoever manages the domain's DNS. */
export function CopyInstructionsButton({ domain }: { domain: SendingDomainDTO }) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <Button size="sm" variant="outline" onClick={() => copy(instructionsText(domain))}>
      {copied ? 'Copied' : 'Copy instructions'}
    </Button>
  )
}
