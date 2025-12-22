import { requireTenant } from '@/lib/tenant'
import { Brush } from 'lucide-react'
import { ThemeCustomizer } from './theme-customizer'
import { LogoUploader } from './logo-uploader'
import { HeaderBranding } from './header-branding'
import { CustomCssEditor } from './custom-css-editor'
import { workspaceService } from '@quackback/domain'
import { getSettingsLogoData, getSettingsHeaderLogoData } from '@/lib/settings-utils'

export default async function BrandingPage({ params }: { params?: Promise<{}> }) {
  // Settings is validated in root layout
  const { settings } = await requireTenant()

  // Fetch branding config from service
  const brandingConfigResult = await workspaceService.getBrandingConfig()
  const brandingConfig = brandingConfigResult.success ? brandingConfigResult.value : {}

  // Get logo, header branding data, and custom CSS for SSR
  const [logoData, headerData, customCssResult] = await Promise.all([
    getSettingsLogoData(),
    getSettingsHeaderLogoData(),
    workspaceService.getCustomCss(),
  ])
  const customCss = customCssResult.success ? customCssResult.value : null

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
          <LogoUploader
            workspaceId={settings.id}
            workspaceName={settings.name}
            initialLogoUrl={logoData?.url ?? null}
          />
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
            workspaceId={settings.id}
            workspaceName={settings.name}
            logoUrl={logoData?.url ?? null}
            initialHeaderLogoUrl={headerData?.url ?? null}
            initialDisplayMode={(headerData?.displayMode as 'logo_and_name' | 'logo_only' | 'custom_logo') ?? 'logo_and_name'}
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
          workspaceId={settings.id}
          initialThemeConfig={brandingConfig}
          logoUrl={logoData?.url ?? null}
          workspaceName={settings.name}
          headerLogoUrl={headerData?.url ?? null}
          headerDisplayMode={(headerData?.displayMode as 'logo_and_name' | 'logo_only' | 'custom_logo') ?? 'logo_and_name'}
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
          <CustomCssEditor workspaceId={settings.id} initialCustomCss={customCss} />
        </div>
      </div>
    </div>
  )
}
