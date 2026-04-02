import { createFileRoute } from '@tanstack/react-router'
import { useIntl, FormattedMessage } from 'react-intl'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { PageHeader } from '@/components/shared/page-header'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { NotificationPreferencesForm } from '@/components/settings/notification-preferences-form'

export const Route = createFileRoute('/_portal/settings/preferences')({
  component: PreferencesPage,
})

function PreferencesPage() {
  const intl = useIntl()

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Cog6ToothIcon}
        title={intl.formatMessage({
          id: 'portal.settings.preferences.title',
          defaultMessage: 'Preferences',
        })}
        description={intl.formatMessage({
          id: 'portal.settings.preferences.description',
          defaultMessage: 'Customize your experience',
        })}
        animate
      />

      {/* Appearance */}
      <div
        className="rounded-xl border border-border/50 bg-card p-6 shadow-sm animate-in fade-in duration-200 fill-mode-backwards"
        style={{ animationDelay: '75ms' }}
      >
        <h2 className="font-medium mb-1">
          <FormattedMessage
            id="portal.settings.preferences.appearance.title"
            defaultMessage="Appearance"
          />
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          <FormattedMessage
            id="portal.settings.preferences.appearance.description"
            defaultMessage="Customize how the app looks"
          />
        </p>
        <div className="space-y-3">
          <p className="text-sm font-medium">
            <FormattedMessage
              id="portal.settings.preferences.appearance.themeLabel"
              defaultMessage="Theme"
            />
          </p>
          <ThemeSwitcher />
        </div>
      </div>

      {/* Notifications */}
      <div
        className="rounded-xl border border-border/50 bg-card p-6 shadow-sm animate-in fade-in duration-200 fill-mode-backwards"
        style={{ animationDelay: '150ms' }}
      >
        <h2 className="font-medium mb-1">
          <FormattedMessage
            id="portal.settings.preferences.notifications.title"
            defaultMessage="Email Notifications"
          />
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          <FormattedMessage
            id="portal.settings.preferences.notifications.description"
            defaultMessage="Manage email notifications for posts you're subscribed to"
          />
        </p>
        <NotificationPreferencesForm />
      </div>
    </div>
  )
}
