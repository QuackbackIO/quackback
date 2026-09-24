import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { UpgradeNotice } from '@/components/admin/upgrade'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { CustomDomainInstruction } from '@/lib/server/control-plane/client'

export function QuackbackUrlCard(props: {
  platformLabel: string
  domainSuffix: string
  pending: boolean
  error: Error | null
  onPlatformLabelChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <SettingsCard title="Workspace URL" description="The address customers use for this workspace">
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
              className="h-full rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
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

const READINESS_LABEL = {
  pending: 'Waiting for DNS',
  ready: 'Ready',
  failed: 'Needs attention',
} as const

export function DomainsCard(props: {
  entitled: boolean
  domains: CustomDomainInstruction[]
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
      title="Custom domain"
      description="Point a hostname you own at this workspace. Traffic goes through Quackback Cloud."
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
              Hostname
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
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{domain.hostname}</p>
                  <Badge
                    size="sm"
                    shape="pill"
                    variant={
                      domain.readiness === 'ready'
                        ? 'secondary'
                        : domain.readiness === 'failed'
                          ? 'destructive'
                          : 'outline'
                    }
                  >
                    {domain.isPrimary ? 'Primary · ' : ''}
                    {READINESS_LABEL[domain.readiness]}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={props.pending}
                    onClick={() => props.onRefresh(domain.hostname)}
                  >
                    Check status
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
                <div className="rounded-md bg-muted/30 px-3 py-2 text-[13px]">
                  <p className="text-muted-foreground">
                    Add a CNAME from <span className="font-mono">{domain.hostname}</span> to{' '}
                    <span className="font-mono">{domain.cnameTarget}</span>.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}
