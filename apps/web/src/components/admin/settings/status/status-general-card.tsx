import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { StatusSettings } from '@/lib/shared/status-settings'

interface StatusGeneralCardProps {
  settings: StatusSettings
  onChange: (patch: Partial<StatusSettings>) => void
  /** Flush any debounced text save immediately (input blur). */
  onFlushText?: () => void
}

export function StatusGeneralCard({ settings, onChange, onFlushText }: StatusGeneralCardProps) {
  return (
    <SettingsCard
      title="General"
      description="The status page publishes from the Status toggle on Settings → General. Hide or rename the portal tab in Portal → Navigation."
    >
      <div className="space-y-2">
        <Label htmlFor="status-description" className="text-sm font-medium">
          Page description
        </Label>
        {/* Not disabled while a save is pending: debounced saves fire mid-typing
            and a disabled input would drop keystrokes. */}
        <Input
          id="status-description"
          value={settings.pageDescription ?? ''}
          onChange={(e) => onChange({ pageDescription: e.target.value || null })}
          onBlur={onFlushText}
          placeholder="Live status for our services. Subscribe to get notified about incidents."
          maxLength={500}
        />
      </div>
    </SettingsCard>
  )
}
