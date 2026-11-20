import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { settingsQueries } from '@/lib/client/queries/settings'
import { readBatch } from '@/lib/client/queries/read-batch'
import { adminPageHead } from '@/lib/client/admin-head'
import {
  useBaseUrl,
  useHasPermission,
  useSessionContext,
  useWorkspaceSettings,
} from '@/lib/client/hooks/use-root-context'
import { isProductEnabled } from '@/lib/shared/types/settings'
import type { HeaderDisplayMode, HelpCenterConfig } from '@/lib/shared/types/settings'
import type { ThemeConfig } from '@/lib/shared/theme'
import { isStatusPagePublished } from '@/lib/shared/status-settings'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import { effectiveSectionDomains, hostOfOrigin } from '@/lib/shared/section-domains'
import { portalTabsFor } from '@/lib/shared/portal-settings-tabs'
import { servedSectionHosts } from '@/components/admin/settings/branding/portal-nav-editor'
import type { PortalBuiltInNavType } from '@/components/public/portal-header-nav'
import { CustomiseEditor } from '@/components/admin/settings/portal-customise/customise-editor'
import { customisePages } from '@/components/admin/settings/portal-customise/pages'
import { useImportDeepLink } from '@/components/admin/settings/portal-customise/import-deep-link'

export const Route = createFileRoute('/admin/settings_/portal/customise')({
  head: adminPageHead('Customise portal'),
  // `?import=acme.com` opens Import already reading that website. Any string is
  // kept here and judged by `useImportDeepLink`, which drops what is no website:
  // this runs in every page's script, and the website check loads with the editor.
  validateSearch: (raw: Record<string, unknown>): { import?: string } => ({
    import: typeof raw.import === 'string' ? raw.import : undefined,
  }),
  beforeLoad: ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/portal/customise')
  },
  loader: async ({ context }) => {
    const ensure = readBatch(context.queryClient)
    // The Help Center home is read (and offered) only to people who manage it.
    const helpCenter = context.permissions?.includes(PERMISSIONS.HELP_CENTER_MANAGE)
    await Promise.all([
      ensure(settingsQueries.branding()),
      ensure(settingsQueries.customCss()),
      ensure(settingsQueries.portalPageConfig()),
      ensure(settingsQueries.logo()),
      ensure(settingsQueries.headerLogo()),
      ...(helpCenter ? [ensure(settingsQueries.helpCenterConfig())] : []),
    ])
  },
  component: PortalCustomisePage,
})

function PortalCustomisePage() {
  const settings = useWorkspaceSettings()
  const session = useSessionContext()
  const canManageHelpCenter = useHasPermission(PERMISSIONS.HELP_CENTER_MANAGE)
  const canChangeIcon = useHasPermission(PERMISSIONS.SETTINGS_MANAGE)
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  // Read once and cleared from the address, so a reload or Back never imports again.
  const takeLinkedImport = useImportDeepLink(search.import, () => {
    void navigate({ search: {}, replace: true })
  })

  const { data: brandingConfig = {} } = useSuspenseQuery(settingsQueries.branding())
  const { data: customCss = '' } = useSuspenseQuery(settingsQueries.customCss())
  const { data: portalConfig } = useSuspenseQuery(settingsQueries.portalPageConfig())
  const { data: squareLogo } = useSuspenseQuery(settingsQueries.logo())
  const { data: headerLogo } = useSuspenseQuery(settingsQueries.headerLogo())
  // Read only with the permission (the loader ensured it then); never a 403.
  const { data: helpCenterConfig } = useQuery({
    ...settingsQueries.helpCenterConfig(),
    enabled: canManageHelpCenter,
  })

  const flags = settings?.featureFlags
  const domain = settings?.helpCenterConfig?.domain
  const pages = useMemo(
    () =>
      customisePages({
        flags: {
          feedback: isProductEnabled(flags, 'feedback'),
          changelog: isProductEnabled(flags, 'changelog'),
          helpCenter: isProductEnabled(flags, 'helpCenter'),
        },
        feedbackLabel: portalConfig.nav?.items?.find((item) => item.type === 'feedback')?.label,
        helpCenterDomain: !!(domain?.domain && domain.verifiedAt),
      }),
    [flags, portalConfig, domain]
  )

  // Built-in tabs that are currently unavailable (product or tab off) keep
  // their rows in the editor but render inert. Mirrors portal-header.
  const gatedTypes = useMemo(() => {
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
  }, [flags, settings, session])

  // A tab served at its own domain shows it under the tab; the domain is set on Custom domains.
  const baseUrl = useBaseUrl()
  const sectionHosts = useMemo(
    () =>
      servedSectionHosts(
        effectiveSectionDomains({
          sectionDomains: settings?.portalConfig?.sectionDomains,
          legacyHelpDomain: settings?.helpCenterConfig?.domain,
          primaryHost: hostOfOrigin(baseUrl),
        })
      ),
    [settings, baseUrl]
  )
  const { permissions } = Route.useRouteContext()
  const linkSectionHosts = portalTabsFor(permissions).includes('custom-domains')

  const helpCenter = canManageHelpCenter ? ((helpCenterConfig as HelpCenterConfig) ?? null) : null
  const name = settings?.name ?? ''
  const loaded = useMemo(
    () => ({
      name,
      headerName: headerLogo?.displayName ?? null,
      theme: brandingConfig as ThemeConfig,
      customCss,
      portal: portalConfig,
      helpCenter,
      logo: {
        wideKey: headerLogo?.key ?? null,
        darkKey: headerLogo?.darkKey ?? null,
        mode: (headerLogo?.displayMode as HeaderDisplayMode | null) ?? 'logo_and_name',
        icon: squareLogo?.key
          ? { key: squareLogo.key, faviconKey: squareLogo.faviconKey ?? null }
          : null,
      },
    }),
    [name, brandingConfig, customCss, portalConfig, helpCenter, headerLogo, squareLogo]
  )
  // The preview reloads when a publish lands, and only then.
  const refreshKey = useMemo(
    () =>
      JSON.stringify([
        brandingConfig,
        customCss,
        portalConfig,
        helpCenterConfig ?? null,
        headerLogo ?? null,
        squareLogo?.url ?? null,
      ]),
    [brandingConfig, customCss, portalConfig, helpCenterConfig, headerLogo, squareLogo]
  )

  return (
    <CustomiseEditor
      // The draft starts from what is loaded once; a Help Center config that
      // arrives after the first render starts it again (nothing is edited yet).
      key={helpCenter ? 'with-help-center' : 'without-help-center'}
      loaded={loaded}
      pages={pages}
      gatedTypes={gatedTypes}
      sectionHosts={sectionHosts}
      linkSectionHosts={linkSectionHosts}
      refreshKey={refreshKey}
      canChangeIcon={canChangeIcon}
      takeLinkedImport={takeLinkedImport}
    />
  )
}
