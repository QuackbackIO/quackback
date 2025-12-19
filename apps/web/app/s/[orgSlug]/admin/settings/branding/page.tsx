import { requireTenantBySlug } from '@/lib/tenant'
import { Brush } from 'lucide-react'
import { ThemeCustomizer } from './theme-customizer'
import { LogoUploader } from './logo-uploader'
import { HeaderBranding } from './header-branding'
import { CustomCssEditor } from './custom-css-editor'
import { workspaceService } from '@quackback/domain'
import { getWorkspaceLogoData, getWorkspaceHeaderLogoData } from '@/lib/workspace'

export default async function BrandingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { workspace } = await requireTenantBySlug(orgSlug)

  // Fetch branding config from service
  const brandingConfigResult = await workspaceService.getBrandingConfig(workspace.id)
  const brandingConfig = brandingConfigResult.success ? brandingConfigResult.value : {}

  // Get logo, header branding data, and custom CSS for SSR
  const [logoData, headerData, customCssResult] = await Promise.all([
    getWorkspaceLogoData(workspace.id),
    getWorkspaceHeaderLogoData(workspace.id),
    workspaceService.getCustomCss(workspace.id),
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
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            initialLogoUrl={logoData.logoUrl}
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
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            logoUrl={logoData.logoUrl}
            initialHeaderLogoUrl={headerData.headerLogoUrl}
            initialDisplayMode={headerData.headerDisplayMode}
            initialDisplayName={headerData.headerDisplayName}
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
          workspaceId={workspace.id}
          initialThemeConfig={brandingConfig}
          logoUrl={logoData.logoUrl}
          workspaceName={workspace.name}
          headerLogoUrl={headerData.headerLogoUrl}
          headerDisplayMode={headerData.headerDisplayMode}
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
          <CustomCssEditor workspaceId={workspace.id} initialCustomCss={customCss} />
        </div>
      </div>
    </div>
  )
}
