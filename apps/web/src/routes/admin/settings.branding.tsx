import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'
import { Brush } from 'lucide-react'
import { ThemeCustomizer } from '@/components/admin/settings/branding/theme-customizer'
import { LogoUploader } from '@/components/admin/settings/branding/logo-uploader'
import { HeaderBranding } from '@/components/admin/settings/branding/header-branding'
import { CustomCssEditor } from '@/components/admin/settings/branding/custom-css-editor'

export const Route = createFileRoute('/admin/settings/branding')({
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { settings, queryClient } = context

    // Pre-fetch all branding data in parallel using React Query
    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.branding()),
      queryClient.ensureQueryData(settingsQueries.logo()),
      queryClient.ensureQueryData(settingsQueries.headerLogo()),
      queryClient.ensureQueryData(settingsQueries.customCss()),
    ])

    return {
      settings,
    }
  },
  component: BrandingPage,
})

function BrandingPage() {
  const { settings } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const brandingConfigQuery = useSuspenseQuery(settingsQueries.branding())
  const logoDataQuery = useSuspenseQuery(settingsQueries.logo())
  const headerDataQuery = useSuspenseQuery(settingsQueries.headerLogo())
  const customCssQuery = useSuspenseQuery(settingsQueries.customCss())

  const brandingConfig = brandingConfigQuery.data ?? {}
  const logoData = logoDataQuery.data
  const headerData = headerDataQuery.data
  const customCss = customCssQuery.data || null

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Brush className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Branding</h1>
          <p className="text-sm text-muted-foreground">
            Customize your portal's appearance and branding
          </p>
        </div>
      </div>

      {/* Logo Section */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="space-y-1">
          <h2 className="font-semibold">Logo</h2>
          <p className="text-sm text-muted-foreground">
            Square logo used as browser favicon and in compact spaces
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <LogoUploader workspaceName={settings!.name} initialLogoUrl={logoData?.url ?? null} />
        </div>
      </div>

      {/* Header Branding Section */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="space-y-1">
          <h2 className="font-semibold">Header Branding</h2>
          <p className="text-sm text-muted-foreground">
            Choose how your brand appears in the portal navigation header
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <HeaderBranding
            workspaceName={settings!.name}
            logoUrl={logoData?.url ?? null}
            initialHeaderLogoUrl={headerData?.url ?? null}
            initialDisplayMode={
              (headerData?.displayMode as 'logo_and_name' | 'logo_only' | 'custom_logo') ??
              'logo_and_name'
            }
            initialDisplayName={headerData?.displayName ?? null}
          />
        </div>
      </div>

      {/* Theme Section */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="space-y-1">
          <h2 className="font-semibold">Theme</h2>
          <p className="text-sm text-muted-foreground">
            Customize colors, typography, and styling to match your brand
          </p>
        </div>
        <ThemeCustomizer
          initialThemeConfig={brandingConfig}
          logoUrl={logoData?.url ?? null}
          workspaceName={settings!.name}
          headerLogoUrl={headerData?.url ?? null}
          headerDisplayMode={
            (headerData?.displayMode as 'logo_and_name' | 'logo_only' | 'custom_logo') ??
            'logo_and_name'
          }
        />
      </div>

      {/* Custom CSS Section */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="space-y-1">
          <h2 className="font-semibold">Custom CSS</h2>
          <p className="text-sm text-muted-foreground">
            Advanced styling with component-level CSS variables and BEM classes
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <CustomCssEditor initialCustomCss={customCss} />
        </div>
      </div>
    </div>
  )
}
