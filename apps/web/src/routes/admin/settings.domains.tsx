import { useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, useRouteContext, useRouter } from '@tanstack/react-router'
import { ArrowPathIcon, GlobeAltIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { UpgradeNotice } from '@/components/admin/upgrade'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getCloudCustomDomainsFn,
  getCloudIdentityFn,
  hasCustomDomainEntitlementFn,
  mutateCloudCustomDomainFn,
  platformLabelFromHostname,
  updateCloudIdentityFn,
} from '@/lib/server/functions/cloud-identity'
import type { CustomDomainInstruction } from '@/lib/server/control-plane/client'
import { platformUrlSuffix } from '@/lib/shared/platform-label'

export const Route = createFileRoute('/admin/settings/domains')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
    const { cloudEnabled } = context
    if (!cloudEnabled)
      return {
        allowed: false,
        entitled: false,
        domains: [] as CustomDomainInstruction[],
        cloudIdentity: null,
      }
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const [entitled, domains, cloudIdentity] = await Promise.all([
      hasCustomDomainEntitlementFn(),
      getCloudCustomDomainsFn().catch(() => [] as CustomDomainInstruction[]),
      getCloudIdentityFn().catch(() => null),
      ensureBillingCatalogue(context.queryClient, context.billingEnabled),
    ])
    return { allowed: true, entitled, domains, cloudIdentity }
  },
  component: DomainsSettingsPage,
})

function DomainsSettingsPage() {
  const { cloudEnabled } = useRouteContext({ from: '__root__' })
  const {
    allowed,
    entitled,
    domains: initialDomains,
    cloudIdentity: initialCloudIdentity,
  } = Route.useLoaderData()
  const [domains, setDomains] = useState(initialDomains)
  const [hostname, setHostname] = useState('')
  const [cloudIdentity, setCloudIdentity] = useState(initialCloudIdentity)
  const [platformLabel, setPlatformLabel] = useState(
    initialCloudIdentity?.platformHostname
      ? platformLabelFromHostname(initialCloudIdentity.platformHostname)
      : ''
  )
  const router = useRouter()

  const identityMutation = useMutation({
    mutationFn: () => {
      const requestedLabel = platformLabel.trim()
      return updateCloudIdentityFn({
        data: requestedLabel ? { platformLabel: requestedLabel } : {},
      })
    },
    onSuccess: async (result) => {
      setCloudIdentity(result.projection)
      setPlatformLabel(
        result.projection.platformHostname
          ? platformLabelFromHostname(result.projection.platformHostname)
          : ''
      )
      if (result.transferToken) {
        const target = new URL('/auth/origin-transfer', result.projection.canonicalOrigin)
        target.searchParams.set('ott', result.transferToken)
        target.searchParams.set('returnTo', '/admin/settings/domains')
        window.location.assign(target)
        return
      }
      toast.success('Workspace URL saved')
      await router.invalidate()
    },
  })

  const mutation = useMutation({
    mutationFn: (input: {
      action: 'add' | 'refresh' | 'makePrimary' | 'remove'
      hostname: string
    }) => mutateCloudCustomDomainFn({ data: input }),
    onSuccess: async (result) => {
      if (result.transferToken) {
        const target = new URL('/auth/origin-transfer', result.projection.canonicalOrigin)
        target.searchParams.set('ott', result.transferToken)
        target.searchParams.set('returnTo', '/admin/settings/domains')
        window.location.assign(target)
        return
      }
      toast.success('Domain updated')
      const next = await getCloudCustomDomainsFn().catch(() => domains)
      setDomains(next)
      setHostname('')
      await router.invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not update that domain.')
    },
  })

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={GlobeAltIcon}
        title="Domains"
        description="Your own hostname for this workspace"
      />
      {!cloudEnabled || !allowed ? (
        <p className="text-sm text-muted-foreground">
          Custom domains are available only in a Quackback Cloud workspace.
        </p>
      ) : (
        <>
          {cloudIdentity && (
            <QuackbackUrlCard
              platformLabel={platformLabel}
              domainSuffix={platformUrlSuffix(cloudIdentity)}
              pending={identityMutation.isPending}
              error={identityMutation.error}
              onPlatformLabelChange={setPlatformLabel}
              onSubmit={() => identityMutation.mutate()}
            />
          )}
          <DomainsCard
            entitled={entitled}
            domains={domains}
            hostname={hostname}
            pending={mutation.isPending}
            error={mutation.error}
            onHostnameChange={setHostname}
            onAdd={() => mutation.mutate({ action: 'add', hostname })}
            onRefresh={(value) => mutation.mutate({ action: 'refresh', hostname: value })}
            onMakePrimary={(value) => mutation.mutate({ action: 'makePrimary', hostname: value })}
            onRemove={(value) => mutation.mutate({ action: 'remove', hostname: value })}
          />
        </>
      )}
    </div>
  )
}

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
