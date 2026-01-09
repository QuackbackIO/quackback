import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'
import { PaintBrushIcon } from '@heroicons/react/24/solid'
import { ThemeCustomizer } from '@/components/admin/settings/branding/theme-customizer'
import { LogoUploader } from '@/components/admin/settings/branding/logo-uploader'
import { HeaderBranding } from '@/components/admin/settings/branding/header-branding'

type HeaderDisplayMode = 'logo_and_name' | 'logo_only' | 'custom_logo'

export const Route = createFileRoute('/admin/settings/branding')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.branding()),
      context.queryClient.ensureQueryData(settingsQueries.logo()),
      context.queryClient.ensureQueryData(settingsQueries.headerLogo()),
    ])
  },
  component: BrandingPage,
})

function BrandingPage() {
  const { settings } = Route.useRouteContext()
  const { data: brandingConfig = {} } = useSuspenseQuery(settingsQueries.branding())
  const { data: logoData } = useSuspenseQuery(settingsQueries.logo())
  const { data: headerData } = useSuspenseQuery(settingsQueries.headerLogo())

  const logoUrl = logoData?.url ?? null
  const headerDisplayMode = (headerData?.displayMode as HeaderDisplayMode) ?? 'logo_and_name'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <PaintBrushIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Branding</h1>
          <p className="text-sm text-muted-foreground">
            Customize your portal's appearance and branding
          </p>
        </div>
      </div>

      <SettingsSection
        title="Logo"
        description="Square logo used as browser favicon and in compact spaces"
      >
        <LogoUploader workspaceName={settings!.name} initialLogoUrl={logoUrl} />
      </SettingsSection>

      <SettingsSection
        title="Header Branding"
        description="Choose how your brand appears in the portal navigation header"
      >
        <HeaderBranding
          workspaceName={settings!.name}
          logoUrl={logoUrl}
          initialHeaderLogoUrl={headerData?.url ?? null}
          initialDisplayMode={headerDisplayMode}
          initialDisplayName={headerData?.displayName ?? null}
        />
      </SettingsSection>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="space-y-1">
          <h2 className="font-semibold">Theme</h2>
          <p className="text-sm text-muted-foreground">
            Customize colors, typography, and styling to match your brand
          </p>
        </div>
        <ThemeCustomizer
          initialThemeConfig={brandingConfig}
          logoUrl={logoUrl}
          workspaceName={settings!.name}
          headerLogoUrl={headerData?.url ?? null}
          headerDisplayMode={headerDisplayMode}
        />
      </div>
    </div>
  )
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-6">{children}</div>
    </div>
  )
}
