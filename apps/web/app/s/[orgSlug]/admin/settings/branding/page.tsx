import { requireTenantBySlug } from '@/lib/tenant'
import { Brush } from 'lucide-react'
import { ThemeCustomizer } from './theme-customizer'
import { LogoUploader } from './logo-uploader'
import { organizationService } from '@quackback/domain'
import { getOrganizationLogoData } from '@/lib/organization'

export default async function BrandingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { organization } = await requireTenantBySlug(orgSlug)

  // Fetch branding config from service
  const brandingConfigResult = await organizationService.getBrandingConfig(organization.id)
  const brandingConfig = brandingConfigResult.success ? brandingConfigResult.value : {}

  // Get logo data for SSR
  const logoData = await getOrganizationLogoData(organization.id)

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
            Your brand logo displayed in the portal header and used as the browser favicon
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <LogoUploader
            organizationId={organization.id}
            organizationName={organization.name}
            initialLogoUrl={logoData.logoUrl}
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
          organizationId={organization.id}
          initialThemeConfig={brandingConfig}
          logoUrl={logoData.logoUrl}
          organizationName={organization.name}
        />
      </div>
    </div>
  )
}
