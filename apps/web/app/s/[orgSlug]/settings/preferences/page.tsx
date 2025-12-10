import { requireTenantBySlug } from '@/lib/tenant'
import { Settings } from 'lucide-react'
import { ThemeSwitcher } from '@/components/theme-switcher'

interface PreferencesPageProps {
  params: Promise<{ orgSlug: string }>
}

export default async function PreferencesPage({ params }: PreferencesPageProps) {
  const { orgSlug } = await params
  await requireTenantBySlug(orgSlug)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Preferences</h1>
          <p className="text-sm text-muted-foreground">Customize your experience</p>
        </div>
      </div>

      {/* Appearance */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Appearance</h2>
        <p className="text-sm text-muted-foreground mb-4">Customize how the app looks</p>
        <div className="space-y-3">
          <p className="text-sm font-medium">Theme</p>
          <ThemeSwitcher />
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Notifications</h2>
        <p className="text-sm text-muted-foreground mb-4">Manage your notification preferences</p>
        <div className="rounded-lg bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Notification settings coming soon</p>
        </div>
      </div>
    </div>
  )
}
