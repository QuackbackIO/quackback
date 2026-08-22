import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ChangelogSettings } from '@/lib/shared/changelog-settings'

interface VisibilityCardProps {
  settings: ChangelogSettings
  onChange: (patch: Partial<ChangelogSettings>) => void
  disabled?: boolean
}

export function VisibilityCard({ settings, onChange, disabled }: VisibilityCardProps) {
  return (
    <SettingsCard
      title="Visibility"
      description="Choose who can see your changelog. Hide or rename the portal tab in Portal → Navigation."
    >
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="pr-4">
          <Label className="text-sm font-medium">Audience</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Public shows the changelog to everyone. Authenticated limits it to signed-in portal
            users.
          </p>
        </div>
        <Select
          value={settings.audience}
          onValueChange={(value) => onChange({ audience: value as ChangelogSettings['audience'] })}
          disabled={disabled}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="authenticated">Authenticated</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </SettingsCard>
  )
}
