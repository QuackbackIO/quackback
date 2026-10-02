import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
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
    <SettingsCard title="Notifications">
      <SettingRows>
        <SettingRow
          label="Email notifications"
          description="Email subscribers when an incident is published or maintenance is scheduled"
          htmlFor="status-emails"
          control={
            <Switch
              id="status-emails"
              checked={!settings.emailsDisabled}
              onCheckedChange={(checked) => onChange({ emailsDisabled: !checked })}
              disabled={disabled}
            />
          }
        />
      </SettingRows>
    </SettingsCard>
  )
}
