import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import { useState } from 'react'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { DOMAINS_PAGE_PERMISSIONS, domainUseLinks } from '@/lib/shared/domains-permissions'
import { useMutation, type QueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import {
  getCloudCustomDomainsFn,
  getCloudIdentityFn,
  hasCustomDomainEntitlementFn,
  mutateCloudCustomDomainFn,
  platformLabelFromHostname,
  updateCloudIdentityFn,
  type WebAddress,
} from '@/lib/server/functions/cloud-identity'
import { platformUrlSuffix } from '@/lib/shared/platform-label'
import { DomainsCard, QuackbackUrlCard } from '@/components/admin/settings/domains-cards'
import {
  DomainList,
  DomainsEmptyState,
  EMPTY_DESCRIPTION,
  domainRows,
} from '@/components/admin/settings/domains-overview'
import { isProductEnabled } from '@/lib/shared/types/settings'
import {
  getHelpCenterDomainSummaryFn,
  getSendingDomainSummariesFn,
  getSignInDomainSummariesFn,
  type HelpCenterDomainSummary,
  type SendingDomainSummary,
  type SignInDomainSummary,
} from '@/lib/server/functions/domains-overview'
import { adminPageHead } from '@/lib/client/admin-head'
import { toastError } from '@/lib/client/error-notice'

export const Route = createFileRoute('/admin/settings/domains')({
  head: adminPageHead('Domains settings'),
  loader: async ({ context }) => {
    assertRouteAnyPermission(context.permissions, DOMAINS_PAGE_PERMISSIONS)
    const can = (permission: PermissionKey) => context.permissions?.includes(permission) ?? false
    const { cloudEnabled } = context
    const webAddresses = can(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)

    const [operator, sending, signIn, helpCenterDomain] = await Promise.all([
      cloudEnabled && webAddresses ? loadOperatorHostnames(context) : null,
      can(EMAIL_SENDING_PERMISSION)
        ? getSendingDomainSummariesFn().catch(() => [] as SendingDomainSummary[])
        : ([] as SendingDomainSummary[]),
      can(PERMISSIONS.AUTH_MANAGE)
        ? getSignInDomainSummariesFn().catch(() => [] as SignInDomainSummary[])
        : ([] as SignInDomainSummary[]),
      !cloudEnabled && webAddresses
        ? getHelpCenterDomainSummaryFn().catch(() => null)
        : (null as HelpCenterDomainSummary | null),
    ])
    return {
      operator,
      sending,
      signIn,
      helpCenterDomain,
      links: domainUseLinks({
        permissions: context.permissions ?? [],
        cloudEnabled: !!cloudEnabled,
        helpCenterOn: isProductEnabled(context.settings?.featureFlags, 'helpCenter'),
      }),
    }
  },
  component: DomainsSettingsPage,
})

async function loadOperatorHostnames(context: {
  queryClient: QueryClient
  billingEnabled: boolean | undefined
}) {
  const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
  const [entitled, domains, cloudIdentity] = await Promise.all([
    hasCustomDomainEntitlementFn(),
    getCloudCustomDomainsFn().catch(() => [] as WebAddress[]),
    getCloudIdentityFn().catch(() => null),
    ensureBillingCatalogue(context.queryClient, context.billingEnabled),
  ])
  return { entitled, domains, cloudIdentity }
}

function DomainsSettingsPage() {
  const { operator, sending, signIn, helpCenterDomain, links } = Route.useLoaderData()
  const rows = domainRows({ sending, signIn, helpCenterDomain })
  // Cloud hostnames keep their own card, where they are added and verified.
  const empty = rows.length === 0 && !operator?.domains.length

  return (
    <SettingsPage
      page="/admin/settings/domains"
      description={empty ? EMPTY_DESCRIPTION : 'Every domain this workspace uses.'}
    >
      {empty && <DomainsEmptyState links={links} />}
      {rows.length > 0 && <DomainList rows={rows} links={links} />}
      {operator && <OperatorHostnames {...operator} />}
    </SettingsPage>
  )
}

/** Hostnames an operator routes to this workspace, set up on this page. */
function OperatorHostnames({
  entitled,
  domains: initialDomains,
  cloudIdentity: initialCloudIdentity,
}: Awaited<ReturnType<typeof loadOperatorHostnames>>) {
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
      toastError(error, 'Could not update that domain.')
    },
  })

  return (
    <>
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
    </>
  )
}
