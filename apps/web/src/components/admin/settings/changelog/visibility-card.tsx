import { SettingsCard } from '@/components/admin/settings/settings-card'
import { VISIBILITY_LABELS, VisibilityTiles } from '@/components/admin/settings/visibility-tiles'
import type { ChangelogSettings } from '@/lib/shared/changelog-settings'

interface VisibilityCardProps {
  settings: ChangelogSettings
  onChange: (patch: Partial<ChangelogSettings>) => void
  disabled?: boolean
}

const OPTIONS: Array<{ value: ChangelogSettings['audience']; title: string }> = [
  { value: 'public', title: VISIBILITY_LABELS.everyone },
  { value: 'authenticated', title: VISIBILITY_LABELS.signedIn },
]

export function VisibilityCard({ settings, onChange, disabled }: VisibilityCardProps) {
  return (
    <SettingsCard title="Visibility" description="Who can see the changelog.">
      <VisibilityTiles
        name="changelog-audience"
        value={settings.audience}
        onChange={(audience) => onChange({ audience })}
        options={OPTIONS}
        disabled={disabled}
        className="sm:grid-cols-2"
      />
    </SettingsCard>
  )
}
