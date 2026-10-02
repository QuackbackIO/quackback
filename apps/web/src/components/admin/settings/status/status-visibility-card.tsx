import { SettingsCard } from '@/components/admin/settings/settings-card'
import { VISIBILITY_LABELS, VisibilityTiles } from '@/components/admin/settings/visibility-tiles'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import type { StatusAudience, StatusSettings } from '@/lib/shared/status-settings'

interface StatusVisibilityCardProps {
  settings: StatusSettings
  onChange: (patch: Partial<StatusSettings>) => void
  disabled?: boolean
}

const AUDIENCE_OPTIONS: Array<{ value: StatusAudience; title: string; description: string }> = [
  {
    value: 'public',
    title: VISIBILITY_LABELS.everyone,
    description: 'Anyone who can reach your portal, with an RSS feed',
  },
  {
    value: 'authenticated',
    title: VISIBILITY_LABELS.signedIn,
    description: 'Only users signed in to your portal',
  },
  {
    value: 'segments',
    title: VISIBILITY_LABELS.segments,
    description: 'Only signed-in users in the segments you choose',
  },
]

export function StatusVisibilityCard({ settings, onChange, disabled }: StatusVisibilityCardProps) {
  const segmentsQuery = useSegments()

  return (
    <SettingsCard title="Visibility" description="Who can view the status page.">
      <div className="space-y-3">
        <VisibilityTiles
          name="status-audience"
          value={settings.audience}
          onChange={(audience) => onChange({ audience })}
          options={AUDIENCE_OPTIONS}
          disabled={disabled}
        />
        {settings.audience === 'segments' &&
          (segmentsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading segments…</p>
          ) : (
            <SegmentMultiSelect
              segments={segmentsQuery.data ?? []}
              value={settings.allowedSegmentIds}
              onChange={(next) => onChange({ allowedSegmentIds: next })}
              disabled={disabled}
              ariaLabel="Status page allowed segments"
            />
          ))}
      </div>
    </SettingsCard>
  )
}
