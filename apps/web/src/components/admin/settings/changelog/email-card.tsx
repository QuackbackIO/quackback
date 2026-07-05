import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { CsvImportSection } from './csv-import-section'
import type { ChangelogSettings } from '@/lib/shared/changelog-settings'

interface EmailCardProps {
  settings: ChangelogSettings
  onChange: (patch: Partial<ChangelogSettings>) => void
  disabled?: boolean
}

export function EmailCard({ settings, onChange, disabled }: EmailCardProps) {
  return (
    <SettingsCard
      title="Email"
      description="Control who gets notified by email when you publish a changelog entry."
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="pr-4">
            <Label htmlFor="changelog-auto-subscribe" className="text-sm font-medium cursor-pointer">
              Auto-subscribe users
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              New and identified end-users are subscribed to changelog emails automatically. They
              can unsubscribe from any email at any time.
            </p>
          </div>
          <Switch
            id="changelog-auto-subscribe"
            checked={settings.autoSubscribe}
            onCheckedChange={(checked) => onChange({ autoSubscribe: checked })}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center justify-between gap-4 py-1">
          <div className="pr-4">
            <Label htmlFor="changelog-emails-disabled" className="text-sm font-medium cursor-pointer">
              Disable changelog emails
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turns off every changelog email workspace-wide. The public changelog page and RSS
              feed are unaffected.
            </p>
          </div>
          <Switch
            id="changelog-emails-disabled"
            checked={settings.emailsDisabled}
            onCheckedChange={(checked) => onChange({ emailsDisabled: checked })}
            disabled={disabled}
          />
        </div>

        <CsvImportSection />
      </div>
    </SettingsCard>
  )
}
