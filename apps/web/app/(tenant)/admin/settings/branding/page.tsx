import { requireTenant } from '@/lib/tenant'
import { Brush } from 'lucide-react'
import { ThemeCustomizer } from './theme-customizer'
import { LogoUploader } from './logo-uploader'
import { theme } from '@quackback/domain'
import { getOrganizationLogoData } from '@/lib/organization'

export default async function BrandingPage() {
  const tenant = await requireTenant()

  // Parse theme config from organization (already loaded by requireTenant)
  const themeConfig = theme.parseThemeConfig(tenant.organization.themeConfig) || {}

  // Get logo data for SSR
  const logoData = await getOrganizationLogoData(tenant.organization.id)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Brush className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Branding</h1>
          <p className="text-sm text-muted-foreground">Customize your portal's logo and colors</p>
        </div>
      </div>

      {/* Logo Uploader */}
      <LogoUploader
        organizationId={tenant.organization.id}
        organizationName={tenant.organization.name}
        initialLogoUrl={logoData.logoUrl}
      />

      {/* Theme Customizer */}
      <ThemeCustomizer organizationId={tenant.organization.id} initialThemeConfig={themeConfig} />
    </div>
  )
}
