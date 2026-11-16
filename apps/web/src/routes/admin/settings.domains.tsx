import { useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import {
  DOMAINS_PAGE_PERMISSIONS,
  DOMAIN_VERIFICATION_ANCHOR,
  domainUseLinks,
} from '@/lib/shared/domains-permissions'
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
import { VerifiedDomainsCard, domainRows } from '@/components/admin/settings/domains-overview'
import {
  listedSections,
  SectionDomainsCard,
} from '@/components/admin/settings/section-domains-card'
import { portalSectionsEnabled } from '@/lib/shared/section-domains'
import { loadDomainSummaries } from '@/lib/client/domain-summaries'
import { adminPageHead } from '@/lib/client/admin-head'
import { toastError } from '@/lib/client/error-notice'

export const Route = createFileRoute('/admin/settings/domains')({
  head: adminPageHead('Domains settings'),
  loader: async ({ context }) => {
    assertRouteAnyPermission(context.permissions, DOMAINS_PAGE_PERMISSIONS)
    const { cloudEnabled } = context
    const webAddresses = context.permissions?.includes(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN) ?? false

    const [operator, summaries] = await Promise.all([
      cloudEnabled && webAddresses ? loadOperatorHostnames(context) : null,
      loadDomainSummaries(context),
    ])
    return {
      operator,
      ...summaries,
      links: domainUseLinks({ permissions: context.permissions ?? [] }),
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

type Operator = Awaited<ReturnType<typeof loadOperatorHostnames>>

/** Go to the Domain verification card and its Domain field, where a Cloud custom domain is added. */
function goToAddDomain() {
  // After the dialog has closed and handed focus back.
  window.setTimeout(() => {
    document.getElementById(DOMAIN_VERIFICATION_ANCHOR)?.scrollIntoView({ behavior: 'smooth' })
    document.getElementById('custom-hostname')?.focus({ preventScroll: true })
  }, 0)
}

/**
 * The Cloud custom domains the operator routes here, and the one change made
 * to them at a time. Making a domain primary may move the session to it.
 */
function useCloudDomains(initial: WebAddress[]) {
  const [domains, setDomains] = useState(initial)
  const router = useRouter()
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
      await router.invalidate()
    },
    onError: (error) => {
      toastError(error, 'Could not update that domain.')
    },
  })
  return { domains, mutation }
}

function DomainsSettingsPage() {
  const { operator, sending, signIn, sectionDomains, added, links } = Route.useLoaderData()
  const { permissions, cloudEnabled, settings } = Route.useRouteContext()
  const router = useRouter()
  const cloud = useCloudDomains(operator?.domains ?? [])
  // Only settings.manage adds a bare domain; the other Domains permissions see the page without it.
  const canAdd = permissions?.includes(PERMISSIONS.SETTINGS_MANAGE) ?? false
  // Custom domains have their own cards below, so the list rows only the domains the workspace owns.
  const rows = domainRows({ sending, signIn, added })
  const sectionEnabled = portalSectionsEnabled({
    featureFlags: settings?.featureFlags,
    statusConfig: settings?.statusConfig,
    portalConfig: settings?.portalConfig,
  })

  return (
    <SettingsPage page="/admin/settings/domains">
      <VerifiedDomainsCard rows={rows} links={links} canAdd={canAdd} />
      {sectionDomains && (
        <SectionDomainsCard
          view={sectionDomains}
          sections={listedSections({
            nav: settings?.portalConfig?.nav,
            sectionEnabled,
            map: sectionDomains.sectionDomains,
          })}
          sectionEnabled={sectionEnabled}
          cloud={!!cloudEnabled}
          readyHostnames={cloud.domains
            .filter((d) => d.readiness === 'ready' && !d.isPrimary)
            .map((d) => d.hostname)}
          canAdd={!cloudEnabled || !!operator?.entitled}
          onChanged={() => void router.invalidate()}
          onMakePrimary={
            operator
              ? (hostname) => cloud.mutation.mutate({ action: 'makePrimary', hostname })
              : undefined
          }
          onAddDomain={operator ? goToAddDomain : undefined}
        />
      )}
      {operator && <OperatorHostnames {...operator} cloud={cloud} />}
    </SettingsPage>
  )
}

/** Hostnames an operator routes to this workspace, set up on this page. */
function OperatorHostnames({
  entitled,
  cloudIdentity: initialCloudIdentity,
  cloud,
}: Operator & { cloud: ReturnType<typeof useCloudDomains> }) {
  const [hostname, setHostname] = useState('')
  const [cloudIdentity, setCloudIdentity] = useState(initialCloudIdentity)
  const [platformLabel, setPlatformLabel] = useState(
    initialCloudIdentity?.platformHostname
      ? platformLabelFromHostname(initialCloudIdentity.platformHostname)
      : ''
  )
  const router = useRouter()
  const { domains, mutation } = cloud

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

  return (
    <>
      <DomainsCard
        entitled={entitled}
        domains={domains}
        hostname={hostname}
        pending={mutation.isPending}
        error={mutation.error}
        onHostnameChange={setHostname}
        onAdd={() =>
          mutation.mutate({ action: 'add', hostname }, { onSuccess: () => setHostname('') })
        }
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
