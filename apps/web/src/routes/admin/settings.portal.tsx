import { lazy, memo, Suspense, useMemo } from 'react'
import { z } from 'zod'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { settingsQueries } from '@/lib/client/queries/settings'
import { readBatch } from '@/lib/client/queries/read-batch'
import { adminPageHead } from '@/lib/client/admin-head'
import {
  useCloudEnabled,
  useHasPermission,
  useSectionDomainsCloud,
  useSessionContext,
  useWorkspaceSettings,
} from '@/lib/client/hooks/use-root-context'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import type { PlanNoticeFeature } from '@/components/admin/settings/plan-feature-notice-body'
import { PortalSummaryCard } from '@/components/admin/settings/portal-customise/summary-card'
import { portalSummary } from '@/components/admin/settings/portal-customise/summary'
import { isProductEnabled } from '@/lib/shared/types/settings'
import type { ThemeConfig } from '@/lib/shared/theme'
import { isStatusPagePublished } from '@/lib/shared/status-settings'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import type { PortalBuiltInNavType } from '@/components/public/portal-header-nav'
import { SETTINGS_PAGES } from '@/lib/shared/settings-pages'
import {
  PORTAL_SETTINGS_PATH,
  PORTAL_TAB_LABELS,
  PORTAL_TABS,
  portalTabsFor,
  resolvePortalTab,
  type PortalTab,
} from '@/lib/shared/portal-settings-tabs'

/**
 * Two tabs, in the `?tab=` pattern of the other settings pages:
 *  - `design`          a summary of the portal's live look, tabs and welcome message
 *                      (settings.branding), which leads to Customise to change them
 *  - `custom-domains`  each section's domain (settings.custom_domain), saved from its
 *                      own dialog. Its code and reads load only when it opens.
 */
const searchSchema = z.object({
  tab: z.enum(PORTAL_TABS).optional(),
})

const loadCustomDomainsTab = () => import('@/components/admin/settings/portal-custom-domains-tab')
const PortalCustomDomainsTab = lazy(loadCustomDomainsTab)

/** The Custom domains tab's code and reads, fetched together when it opens. */
async function warmCustomDomainsTab(queryClient: QueryClient, cloud: boolean) {
  const [{ portalCustomDomainsQueries }] = await Promise.all([
    import('@/lib/client/queries/portal-custom-domains'),
    loadCustomDomainsTab(),
  ])
  await queryClient.ensureQueryData(portalCustomDomainsQueries.tab(cloud))
}

/**
 * The same, read ahead when the pointer or focus reaches the tab. A tab switch
 * keeps the page's route match, so the router reads nothing ahead of it; this
 * does, and the tab then opens on data already in hand. A failed read waits
 * for the tab, which shows it.
 */
function readCustomDomainsTabAhead(queryClient: QueryClient, cloud: boolean) {
  void Promise.all([
    import('@/lib/client/queries/portal-custom-domains'),
    loadCustomDomainsTab(),
  ]).then(([{ portalCustomDomainsQueries }]) =>
    queryClient.prefetchQuery(portalCustomDomainsQueries.tab(cloud))
  )
}

export const Route = createFileRoute('/admin/settings/portal')({
  head: adminPageHead('Portal settings'),
  validateSearch: searchSchema,
  loader: async ({ context, location }) => {
    // Each tab opens to its own permission, which non-admin team roles lack.
    // Gate the page instead of letting managers land on a shell full of 403s.
    assertSettingsPageAccess(context.permissions, '/admin/settings/portal')
    const tabs = portalTabsFor(context.permissions)
    const tab = resolvePortalTab((location.search as { tab?: PortalTab }).tab, tabs)

    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = readBatch(context.queryClient)
    await Promise.all([
      // Everything the Design summary shows, and Customise publishes, takes
      // settings.branding (the tabs and welcome message too, decision Q2).
      ...(tabs.includes('design')
        ? [
            ensure(settingsQueries.branding()),
            ensure(settingsQueries.logo()),
            ensure(settingsQueries.headerLogo()),
            ensure(settingsQueries.customCss()),
            ensure(settingsQueries.portalPageConfig()),
          ]
        : []),
      tab === 'custom-domains'
        ? warmCustomDomainsTab(context.queryClient, !!context.sectionDomainsCloud)
        : null,
      ensureBillingCatalogue(context.queryClient, context.billingEnabled),
    ])
    return { tabs }
  },
  component: PortalSettingsRoute,
})

function PortalSettingsRoute() {
  const { tabs } = Route.useLoaderData()
  const search = Route.useSearch()
  const tab = resolvePortalTab(search.tab, tabs)
  if (tabs.includes('design')) return <PortalPage tab={tab} tabs={tabs} />
  // settings.custom_domain alone: the Custom domains tab is the page.
  return (
    <SettingsPage page="/admin/settings/portal">
      <PortalTabBar tab={tab} tabs={tabs} />
      <PlanFeatureNotice feature="customDomain" />
      <CustomDomainsPanel />
    </SettingsPage>
  )
}

/**
 * The tab bar, shown when the viewer has both tabs. A tab the viewer lacks the
 * permission for is not there at all.
 */
const PortalTabBar = memo(function PortalTabBar({
  tab,
  tabs,
}: {
  tab: PortalTab
  tabs: readonly PortalTab[]
}) {
  const queryClient = useQueryClient()
  const cloud = useSectionDomainsCloud()
  if (tabs.length < 2) return null
  const readAhead = () => readCustomDomainsTabAhead(queryClient, cloud)
  // Links drawn with the tab slots, like a module's tabs, not <Tabs> as other settings pages use: on this page <Tabs> added 1.5 KB of HTML (over the ceiling), 3 KB of JS and a chunk.
  return (
    <nav
      aria-label={SETTINGS_PAGES[PORTAL_SETTINGS_PATH].label}
      data-slot="tabs-list"
      data-variant="line"
      className="scrollbar-none relative flex items-center overflow-x-auto"
    >
      {tabs.map((value) => (
        <Link
          key={value}
          to={PORTAL_SETTINGS_PATH}
          // Design is the default, so its link carries no tab.
          search={value === 'design' ? {} : { tab: value }}
          replace
          data-slot="tabs-trigger"
          data-variant="line"
          data-active={value === tab ? '' : undefined}
          aria-current={value === tab ? 'page' : undefined}
          className="inline-flex shrink-0 items-center text-sm whitespace-nowrap transition-colors"
          {...(value === 'custom-domains' && value !== tab
            ? { onMouseEnter: readAhead, onFocus: readAhead, onTouchStart: readAhead }
            : {})}
        >
          {PORTAL_TAB_LABELS[value]}
        </Link>
      ))}
    </nav>
  )
})

/** The Custom domains tab, its code and reads loaded when it opens. */
function CustomDomainsPanel() {
  const cloud = useSectionDomainsCloud()
  return (
    <Suspense fallback={null}>
      <PortalCustomDomainsTab cloud={cloud} />
    </Suspense>
  )
}

function PortalPage({ tab, tabs }: { tab: PortalTab; tabs: readonly PortalTab[] }) {
  return (
    <SettingsPage page="/admin/settings/portal" width={tab === 'design' ? 'wide' : 'form'}>
      <PortalTabBar tab={tab} tabs={tabs} />
      <PlanFeatureNotice feature={tab === 'design' ? 'customCss' : 'customDomain'} />
      {tab === 'design' ? <DesignSummary /> : <CustomDomainsPanel />}
    </SettingsPage>
  )
}

/** What is live, with the one way into Customise. No drafts are kept here. */
function DesignSummary() {
  const settings = useWorkspaceSettings()
  const session = useSessionContext()
  const canManageHelpCenter = useHasPermission(PERMISSIONS.HELP_CENTER_MANAGE)

  const { data: brandingConfig = {} } = useSuspenseQuery(settingsQueries.branding())
  const { data: logoData } = useSuspenseQuery(settingsQueries.logo())
  const { data: headerLogo } = useSuspenseQuery(settingsQueries.headerLogo())
  const { data: customCss = '' } = useSuspenseQuery(settingsQueries.customCss())
  const { data: portalConfig } = useSuspenseQuery(settingsQueries.portalPageConfig())

  // Built-in tabs that are currently unavailable (product or tab off) are not counted.
  const gatedTypes = useMemo(() => {
    const flags = settings?.featureFlags
    const statusAudience = settings?.statusConfig?.audience ?? 'public'
    const statusLoggedIn = !!session?.user && session.user.principalType !== 'anonymous'
    const gates: Record<PortalBuiltInNavType, boolean> = {
      feedback: isProductEnabled(flags, 'feedback'),
      roadmap: isProductEnabled(flags, 'feedback'),
      changelog: isProductEnabled(flags, 'changelog'),
      help: isProductEnabled(flags, 'helpCenter'),
      support: isPortalSupportSurfaceEnabled(flags, settings?.portalConfig),
      status:
        isStatusPagePublished(flags, settings?.statusConfig) &&
        (statusAudience === 'public' || statusLoggedIn),
    }
    return new Set(
      (Object.keys(gates) as PortalBuiltInNavType[]).filter((type) => !gates[type])
    ) as ReadonlySet<string>
  }, [settings, session])

  const summary = useMemo(
    () =>
      portalSummary({
        theme: brandingConfig as ThemeConfig,
        customCss,
        portal: { nav: portalConfig.nav, welcomeCard: portalConfig.welcomeCard },
        logoUrl: logoData?.url ?? null,
        headerLogo: headerLogo
          ? { url: headerLogo.url, displayMode: headerLogo.displayMode }
          : null,
        gatedTypes,
      }),
    [brandingConfig, customCss, portalConfig, logoData, headerLogo, gatedTypes]
  )

  return (
    <div className="space-y-4">
      <PortalSummaryCard summary={summary} />
      <SettingsCard flush>
        <SettingsList>
          <SettingsListRow
            title="Workspace name"
            meta={settings?.name}
            to="/admin/settings/general"
            trailing={<span className="text-[13px] text-muted-foreground">General</span>}
          />
          {canManageHelpCenter ? (
            <SettingsListRow
              title="Help Center domain and languages"
              to="/admin/settings/help-center"
              trailing={<span className="text-[13px] text-muted-foreground">Help Center</span>}
            />
          ) : null}
        </SettingsList>
      </SettingsCard>
    </div>
  )
}

/**
 * The paused notice. The plan billing check lives in this route rather than a
 * shared module, so without plan billing the page loads no extra chunk.
 */
const PlanFeatureNoticeBody = lazy(
  () => import('@/components/admin/settings/plan-feature-notice-body')
)

function PlanFeatureNotice({ feature }: { feature: PlanNoticeFeature }) {
  if (!useCloudEnabled()) return null
  return (
    <Suspense fallback={null}>
      <PlanFeatureNoticeBody feature={feature} />
    </Suspense>
  )
}
