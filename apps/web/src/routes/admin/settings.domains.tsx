import { useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { GlobeAltIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
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
import { DomainsCard, QuackbackUrlCard } from '@/components/admin/settings/domains-cards'
import { useCloudEnabled } from '@/lib/client/hooks/use-root-context'

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
  const cloudEnabled = useCloudEnabled()
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
