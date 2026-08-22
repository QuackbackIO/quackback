import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { StatusSettings } from '@/lib/shared/status-settings'

interface StatusGeneralCardProps {
  settings: StatusSettings
  onChange: (patch: Partial<StatusSettings>) => void
  /** Flush any debounced text save immediately (input blur). */
  onFlushText?: () => void
  disabled?: boolean
}

export function StatusGeneralCard({
  settings,
  onChange,
  onFlushText,
  disabled,
}: StatusGeneralCardProps) {
  return (
    <SettingsCard
      title="General"
      description="Publish the status page. Hide or rename the portal tab in Branding → Navigation."
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="pr-4">
            <Label htmlFor="status-enabled" className="text-sm font-medium cursor-pointer">
              Publish status page
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Makes the page public and starts recording uptime history.
            </p>
          </div>
          <Switch
            id="status-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) => onChange({ enabled: checked })}
            disabled={disabled}
          />
        </div>

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
      </div>
    </SettingsCard>
  )
}
