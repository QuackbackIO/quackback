/**
 * The Custom domains tab of Settings > Portal: the Custom domains card (the
 * primary domain, then each section with a domain of its own), and on Cloud
 * the Domain verification card where a custom domain is added and the
 * workspace URL. Each saves from its own dialog or form, so the tab has no
 * save bar. Loaded only when the tab opens, with its data.
 */
import { useCallback, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  getCloudCustomDomainsFn,
  mutateCloudCustomDomainFn,
  platformLabelFromHostname,
  updateCloudIdentityFn,
  type WebAddress,
} from '@/lib/server/functions/cloud-identity'
import { platformUrlSuffix } from '@/lib/shared/platform-label'
import {
  DomainsCard,
  hostnameRecords,
  QuackbackUrlCard,
} from '@/components/admin/settings/domains-cards'
import {
  listedSections,
  SectionDomainsCard,
} from '@/components/admin/settings/section-domains-card'
import { portalSectionsEnabled } from '@/lib/shared/section-domains'
import { ADD_DOMAIN_LINK, DOMAIN_VERIFICATION_ANCHOR } from '@/lib/shared/domains-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { CUSTOM_DOMAINS_HREF } from '@/lib/shared/portal-settings-tabs'
import {
  portalCustomDomainsQueries,
  type CustomDomainsOperator,
} from '@/lib/client/queries/portal-custom-domains'
import { useHasPermission, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { toastError } from '@/lib/client/error-notice'

/** Go to the Domain verification card and its Domain field, where a Cloud custom domain is added. */
function goToAddDomain() {
  // After the dialog has closed and handed focus back.
  window.setTimeout(() => {
    document.getElementById(DOMAIN_VERIFICATION_ANCHOR)?.scrollIntoView({ behavior: 'smooth' })
    document.getElementById('custom-hostname')?.focus({ preventScroll: true })
  }, 0)
}

/**
 * Moves the session to the domain that became the canonical one, back to this
 * tab. The page is left on purpose, so the page's unsaved-changes guard is
 * dropped first (`onLeave`): the change it would ask about has already been made.
 */
function transferTo(canonicalOrigin: string, token: string, onLeave?: () => void) {
  onLeave?.()
  const target = new URL('/auth/origin-transfer', canonicalOrigin)
  target.searchParams.set('ott', token)
  target.searchParams.set('returnTo', CUSTOM_DOMAINS_HREF)
  window.location.assign(target)
}

/**
 * The Cloud custom domains the operator routes here, as the tab's query last
 * read them, and the one change made to them at a time. A change reads them
 * again through the query. Making a domain primary may move the session to it.
 */
function useCloudDomains(
  domains: WebAddress[],
  onChanged: () => Promise<void>,
  onLeave?: () => void
) {
  const mutation = useMutation({
    mutationFn: (input: {
      action: 'add' | 'refresh' | 'makePrimary' | 'remove'
      hostname: string
    }) => mutateCloudCustomDomainFn({ data: input }),
    onSuccess: async (result) => {
      if (result.transferToken) {
        transferTo(result.projection.canonicalOrigin, result.transferToken, onLeave)
        return
      }
      toast.success('Domain updated')
      await onChanged()
    },
    onError: (error) => {
      toastError(error, 'Could not update that domain.')
    },
  })
  return { domains, mutation }
}

const NO_DOMAINS: WebAddress[] = []

export default function PortalCustomDomainsTab({
  cloud,
  onLeave,
}: {
  cloud: boolean
  /** Called before the tab sends the browser to another domain. */
  onLeave?: () => void
}) {
  const settings = useWorkspaceSettings()
  const queryClient = useQueryClient()
  const router = useRouter()
  const query = portalCustomDomainsQueries.tab(cloud)
  const { data } = useSuspenseQuery(query)
  const { sectionDomains, operator } = data
  // The tab's own reads, then the workspace settings the product pages' read-only lines use.
  const onChanged = async () => {
    await queryClient.invalidateQueries({ queryKey: query.queryKey })
    await router.invalidate()
  }
  const cloudDomains = useCloudDomains(operator?.domains ?? NO_DOMAINS, onChanged, onLeave)
  // Add custom domain reads the Verified domains when it opens, not with the tab.
  const loadVerifiedDomains = useCallback(
    () => queryClient.fetchQuery(portalCustomDomainsQueries.verifiedDomains()),
    [queryClient]
  )
  // The records a Cloud custom domain needs, read fresh for Add custom domain's DNS step.
  const loadCloudRecords = useCallback(async (hostname: string) => {
    const domain = (await getCloudCustomDomainsFn()).find((d) => d.hostname === hostname)
    return domain ? hostnameRecords(domain) : []
  }, [])
  // Only settings.manage adds a domain, so only its holder is sent to Add domain.
  const canAddDomain = useHasPermission(PERMISSIONS.SETTINGS_MANAGE)
  const sectionEnabled = portalSectionsEnabled({
    featureFlags: settings?.featureFlags,
    statusConfig: settings?.statusConfig,
    portalConfig: settings?.portalConfig,
  })

  return (
    <div className="space-y-6">
      {sectionDomains && (
        <SectionDomainsCard
          view={sectionDomains}
          sections={listedSections({
            nav: settings?.portalConfig?.nav,
            sectionEnabled,
            map: sectionDomains.sectionDomains,
          })}
          sectionEnabled={sectionEnabled}
          cloud={cloud}
          readyHostnames={cloudDomains.domains
            .filter((d) => d.readiness === 'ready' && !d.isPrimary)
            .map((d) => d.hostname)}
          cloudHostnames={cloudDomains.domains.map((d) => d.hostname)}
          loadVerifiedDomains={loadVerifiedDomains}
          loadCloudRecords={cloud ? loadCloudRecords : undefined}
          // Through the router, so unsaved Design changes ask first, as leaving the page does.
          onAddVerifiedDomain={
            canAddDomain ? () => void router.navigate(ADD_DOMAIN_LINK) : undefined
          }
          canAdd={!cloud || !!operator?.entitled}
          onChanged={() => void onChanged()}
          onMakePrimary={
            operator
              ? (hostname) => cloudDomains.mutation.mutate({ action: 'makePrimary', hostname })
              : undefined
          }
          onAddDomain={operator ? goToAddDomain : undefined}
        />
      )}
      {operator && (
        <OperatorHostnames
          {...operator}
          cloud={cloudDomains}
          onChanged={onChanged}
          onLeave={onLeave}
        />
      )}
    </div>
  )
}

/** Hostnames an operator routes to this workspace, set up on this tab. */
function OperatorHostnames({
  entitled,
  cloudIdentity: initialCloudIdentity,
  cloud,
  onChanged,
  onLeave,
}: CustomDomainsOperator & {
  cloud: ReturnType<typeof useCloudDomains>
  onChanged: () => Promise<void>
  onLeave?: () => void
}) {
  const [hostname, setHostname] = useState('')
  const [cloudIdentity, setCloudIdentity] = useState(initialCloudIdentity)
  const [platformLabel, setPlatformLabel] = useState(
    initialCloudIdentity?.platformHostname
      ? platformLabelFromHostname(initialCloudIdentity.platformHostname)
      : ''
  )
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
        transferTo(result.projection.canonicalOrigin, result.transferToken, onLeave)
        return
      }
      toast.success('Workspace URL saved')
      await onChanged()
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
