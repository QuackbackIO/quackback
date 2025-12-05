import { requireTenant } from '@/lib/tenant'
import { Palette } from 'lucide-react'
import { ThemeCustomizer } from './theme-customizer'
import { theme } from '@quackback/shared'

export default async function AppearancePage() {
  const tenant = await requireTenant()

  // Parse theme config from organization (already loaded by requireTenant)
  const themeConfig = theme.parseThemeConfig(tenant.organization.themeConfig) || {}

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Palette className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Appearance</h1>
          <p className="text-sm text-muted-foreground">Customize your portal's look and feel</p>
        </div>
      </div>

      {/* Theme Customizer */}
      <ThemeCustomizer organizationId={tenant.organization.id} initialThemeConfig={themeConfig} />
    </div>
  )
}
