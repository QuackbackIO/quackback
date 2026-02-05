import { createFileRoute } from '@tanstack/react-router'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { PageHeader } from '@/components/shared/page-header'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { NotificationPreferencesForm } from '@/components/settings/notification-preferences-form'

export const Route = createFileRoute('/_portal/settings/preferences')({
  component: PreferencesPage,
})

function PreferencesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Cog6ToothIcon}
        title="Preferences"
        description="Customize your experience"
        animate
      />

      {/* Appearance */}
      <div
        className="rounded-xl border border-border/50 bg-card p-6 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
        style={{ animationDelay: '75ms' }}
      >
        <h2 className="font-medium mb-1">Appearance</h2>
        <p className="text-sm text-muted-foreground mb-4">Customize how the app looks</p>
        <div className="space-y-3">
          <p className="text-sm font-medium">Theme</p>
          <ThemeSwitcher />
        </div>
      </div>

      {/* Notifications */}
      <div
        className="rounded-xl border border-border/50 bg-card p-6 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
        style={{ animationDelay: '150ms' }}
      >
        <h2 className="font-medium mb-1">Email Notifications</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Manage email notifications for posts you&apos;re subscribed to
        </p>
        <NotificationPreferencesForm />
      </div>
    </div>
  )
}
