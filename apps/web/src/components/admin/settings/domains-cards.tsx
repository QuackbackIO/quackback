import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { UpgradeNotice } from '@/components/admin/upgrade'
import { Button } from '@/components/ui/button'
import { StateBadge } from '@/components/shared/state-badge'
import {
  DnsRecordTable,
  FULL_NAMES_NOTE,
  type DnsRecordRow,
} from '@/components/shared/dns-record-table'
import type { CustomDomainInstruction } from '@/lib/server/control-plane/client'
import { pendingProvenLabel, type ShownProofSource } from '@/lib/shared/domain-proof'
import { WEB_ADDRESSES_TITLE } from './domains-overview'

/** A hostname, with the proof that covers it when this workspace already holds one. */
type HostnameRow = CustomDomainInstruction & { provenBy?: ShownProofSource | null }

export function QuackbackUrlCard(props: {
  platformLabel: string
  domainSuffix: string
  pending: boolean
  error: Error | null
  onPlatformLabelChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <SettingsCard title="Workspace URL" description="The address customers use for this workspace.">
      <form
        className="max-w-xl space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          props.onSubmit()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="platform-label" className="text-xs text-muted-foreground">
            Workspace URL
          </Label>
          <div className="flex h-9 items-center border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] dark:bg-input/30 [border-radius:calc(var(--radius)*0.8)]">
            <Input
              id="platform-label"
              value={props.platformLabel}
              onChange={(event) => props.onPlatformLabelChange(event.target.value)}
              className="h-full border-0 focus-visible:ring-0"
              maxLength={63}
              autoCapitalize="none"
              autoCorrect="off"
              disabled={props.pending}
            />
            <span className="shrink-0 pe-3 text-sm text-muted-foreground">
              .{props.domainSuffix}
            </span>
          </div>
        </div>
        {props.error && (
          <p role="alert" className="text-sm text-destructive">
            {props.error.message || 'Could not save Workspace URL. Try again.'}
          </p>
        )}
        <Button type="submit" disabled={props.pending || !props.platformLabel.trim()}>
          {props.pending && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
          Save
        </Button>
      </form>
    </SettingsCard>
  )
}

/** A well-formed TXT record the operator returned; anything else renders nothing. */
function isTxtRecord(value: unknown): value is { name: string; value: string } {
  if (!value || typeof value !== 'object') return false
  const record = value as { name?: unknown; value?: unknown }
  return typeof record.name === 'string' && typeof record.value === 'string'
}

const READINESS_STATE = {
  pending: 'waiting',
  ready: 'found',
  failed: 'problem',
} as const

/**
 * The records a hostname needs: the CNAME that routes it and, until it is
 * seen, the TXT that proves this workspace controls it, unless a zone the
 * workspace already proved covers it. Readiness is reported for the hostname
 * as a whole, so every row shares it and a failure is explained once, under
 * the last row.
 */
function hostnameRecords(domain: HostnameRow): DnsRecordRow[] {
  const state = READINESS_STATE[domain.readiness]
  const records: DnsRecordRow[] = [
    {
      label: 'Routing',
      type: 'CNAME',
      name: domain.hostname,
      value: domain.cnameTarget,
      state,
    },
  ]
  if (!domain.provenBy && isTxtRecord(domain.ownershipProof)) {
    records.push({
      label: 'Ownership',
      type: 'TXT',
      name: domain.ownershipProof.name,
      value: domain.ownershipProof.value,
      state,
    })
  }
  records[records.length - 1]!.problem =
    "We couldn't confirm these records. Check each name and value, then verify."
  return records
}

/** No badge when ready; Pending while waiting; Needs attention when failed. */
function ReadinessBadge({ readiness }: { readiness: CustomDomainInstruction['readiness'] }) {
  if (readiness === 'ready') return null
  return <StateBadge state={readiness === 'pending' ? 'pending' : 'attention'} />
}

export function DomainsCard(props: {
  entitled: boolean
  domains: HostnameRow[]
  hostname: string
  pending: boolean
  error: Error | null
  onHostnameChange: (value: string) => void
  onAdd: () => void
  onRefresh: (hostname: string) => void
  onMakePrimary: (hostname: string) => void
  onRemove: (hostname: string) => void
}) {
  return (
    <SettingsCard
      title={WEB_ADDRESSES_TITLE}
      description="Where people reach your portal and help center."
    >
      {!props.entitled ? (
        <UpgradeNotice entitlement="customDomain" />
      ) : (
        <form
          className="max-w-xl space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            props.onAdd()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="custom-hostname" className="text-xs text-muted-foreground">
              Domain
            </Label>
            <Input
              id="custom-hostname"
              value={props.hostname}
              onChange={(event) => props.onHostnameChange(event.target.value)}
              placeholder="feedback.example.com"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={props.pending}
            />
          </div>
          <Button type="submit" size="sm" disabled={props.pending || !props.hostname.trim()}>
            Add domain
          </Button>
        </form>
      )}

      {props.error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {props.error.message}
        </p>
      )}

      {props.domains.length > 0 && (
        <ul className="mt-6 divide-y divide-border/50">
          {props.domains.map((domain) => (
            <li key={domain.hostname} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{domain.hostname}</span>
                    <ReadinessBadge readiness={domain.readiness} />
                  </div>
                  {domain.isPrimary && (
                    <p className="mt-px text-[13px] text-muted-foreground">Primary</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={props.pending}
                    onClick={() => props.onRefresh(domain.hostname)}
                  >
                    Verify
                  </Button>
                  {domain.readiness === 'ready' && !domain.isPrimary && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={props.pending}
                      onClick={() => props.onMakePrimary(domain.hostname)}
                    >
                      Make primary
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={props.pending}
                    onClick={() => props.onRemove(domain.hostname)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {domain.readiness !== 'ready' && (
                <div className="space-y-1">
                  <DnsRecordTable records={hostnameRecords(domain)} />
                  {domain.provenBy && (
                    <p className="text-xs text-muted-foreground">
                      {pendingProvenLabel(domain.provenBy)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{FULL_NAMES_NOTE}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}
