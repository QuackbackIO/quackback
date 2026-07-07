import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { StatusSettings } from '@/lib/shared/status-settings'

interface StatusNotificationsCardProps {
  settings: StatusSettings
  onChange: (patch: Partial<StatusSettings>) => void
  disabled?: boolean
}

export function StatusNotificationsCard({
  settings,
  onChange,
  disabled,
}: StatusNotificationsCardProps) {
  return (
    <SettingsCard
      title="Notifications"
      description="How subscribers hear about incidents and maintenance."
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="pr-4">
            <Label htmlFor="status-emails" className="text-sm font-medium cursor-pointer">
              Email notifications
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Email subscribers once, when a new incident is published or maintenance is scheduled.
              Updates and resolves appear on the page and in-app, not by email.
            </p>
          </div>
          <Switch
            id="status-emails"
            checked={!settings.emailsDisabled}
            onCheckedChange={(checked) => onChange({ emailsDisabled: !checked })}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center justify-between gap-4 py-1">
          <div className="pr-4">
            <Label htmlFor="status-auto-subscribe" className="text-sm font-medium cursor-pointer">
              Auto-subscribe portal members
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              New portal sign-ups are subscribed to the whole page. They can unsubscribe anytime.
            </p>
          </div>
          <Switch
            id="status-auto-subscribe"
            checked={settings.autoSubscribe}
            onCheckedChange={(checked) => onChange({ autoSubscribe: checked })}
            disabled={disabled}
          />
        </div>
      </div>
    </SettingsCard>
  )
}
