import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { StatusSettings } from '@/lib/shared/status-settings'

interface StatusGeneralCardProps {
  settings: StatusSettings
  onChange: (patch: Partial<StatusSettings>) => void
  disabled?: boolean
}

export function StatusGeneralCard({ settings, onChange, disabled }: StatusGeneralCardProps) {
  return (
    <SettingsCard
      title="General"
      description="Turn the status page on and control where it appears."
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="pr-4">
            <Label htmlFor="status-enabled" className="text-sm font-medium cursor-pointer">
              Enable status page
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Publishes your status page and starts recording uptime history.
            </p>
          </div>
          <Switch
            id="status-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) => onChange({ enabled: checked })}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center justify-between gap-4 py-1">
          <div className="pr-4">
            <Label htmlFor="status-portal-tab" className="text-sm font-medium cursor-pointer">
              Show tab on portal
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Adds a Status tab to the portal navigation for viewers who can see the page.
            </p>
          </div>
          <Switch
            id="status-portal-tab"
            checked={settings.portalTabEnabled}
            onCheckedChange={(checked) => onChange({ portalTabEnabled: checked })}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status-description" className="text-sm font-medium">
            Page description
          </Label>
          <Input
            id="status-description"
            value={settings.pageDescription ?? ''}
            onChange={(e) => onChange({ pageDescription: e.target.value || null })}
            placeholder="Live status for our services. Subscribe to get notified about incidents."
            disabled={disabled}
            maxLength={500}
          />
        </div>
      </div>
    </SettingsCard>
  )
}
