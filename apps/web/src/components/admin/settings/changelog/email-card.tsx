import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { CsvImportSection } from './csv-import-section'
import type { ChangelogSettings } from '@/lib/shared/changelog-settings'

interface EmailCardProps {
  settings: ChangelogSettings
  onChange: (patch: Partial<ChangelogSettings>) => void
  disabled?: boolean
}

export function EmailCard({ settings, onChange, disabled }: EmailCardProps) {
  return (
    <SettingsCard title="Email" description="Who gets emailed when you publish an entry.">
      <SettingRows>
        <SettingRow
          label="Send changelog emails"
          htmlFor="changelog-emails-enabled"
          control={
            <Switch
              id="changelog-emails-enabled"
              checked={!settings.emailsDisabled}
              onCheckedChange={(checked) => onChange({ emailsDisabled: !checked })}
              disabled={disabled}
            />
          }
        />
        <SettingRow
          label="Auto-subscribe users"
          description="Subscribe new users automatically"
          htmlFor="changelog-auto-subscribe"
          control={
            <Switch
              id="changelog-auto-subscribe"
              checked={settings.autoSubscribe}
              onCheckedChange={(checked) => onChange({ autoSubscribe: checked })}
              disabled={disabled}
            />
          }
        />
        <div className="pt-3.5">
          <CsvImportSection />
        </div>
      </SettingRows>
    </SettingsCard>
  )
}
