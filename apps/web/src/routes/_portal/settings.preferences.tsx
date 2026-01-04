import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { NotificationPreferencesForm } from '@/components/settings/notification-preferences-form'

export const Route = createFileRoute('/_portal/settings/preferences')({
  component: PreferencesPage,
})

function PreferencesPage() {
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
        <h2 className="font-medium mb-1">Email Notifications</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Manage email notifications for posts you&apos;re subscribed to
        </p>
        <NotificationPreferencesForm />
      </div>
    </div>
  )
}
