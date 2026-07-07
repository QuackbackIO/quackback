import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { cn } from '@/lib/shared/utils'
import type { StatusAudience, StatusSettings } from '@/lib/shared/status-settings'

interface StatusVisibilityCardProps {
  settings: StatusSettings
  onChange: (patch: Partial<StatusSettings>) => void
  disabled?: boolean
}

const AUDIENCE_OPTIONS: Array<{ value: StatusAudience; label: string; description: string }> = [
  {
    value: 'public',
    label: 'Public',
    description:
      'Anyone who can reach your portal. Enables the RSS feed. Subscribing to email updates requires signing in.',
  },
  {
    value: 'authenticated',
    label: 'Logged-in users',
    description:
      'Only people signed in to your portal — a private status page for customers or employees.',
  },
  {
    value: 'segments',
    label: 'Specific segments',
    description:
      'Only signed-in people in the segments you choose. Each viewer sees only the components their segments allow.',
  },
]

export function StatusVisibilityCard({ settings, onChange, disabled }: StatusVisibilityCardProps) {
  const segmentsQuery = useSegments()

  return (
    <SettingsCard
      title="Visibility"
      description="Who can view the status page. Components can additionally be limited to segments."
    >
      <RadioGroup
        value={settings.audience}
        onValueChange={(value) => onChange({ audience: value as StatusAudience })}
        className="gap-3"
      >
        {AUDIENCE_OPTIONS.map((option) => {
          const checked = settings.audience === option.value
          return (
            <label
              key={option.value}
              className={cn(
                'flex gap-3 items-start rounded-lg border px-3.5 py-3 cursor-pointer transition-colors',
                checked ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:bg-muted/30',
                disabled && 'cursor-not-allowed opacity-60'
              )}
            >
              <RadioGroupItem value={option.value} disabled={disabled} className="mt-0.5" />
              <div className="flex-1 space-y-2">
                <div className="text-sm font-medium">{option.label}</div>
                <p className="text-xs text-muted-foreground">{option.description}</p>
                {option.value === 'segments' && checked && (
                  <div className="pt-1">
                    {segmentsQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">Loading segments…</p>
                    ) : (
                      <SegmentMultiSelect
                        segments={segmentsQuery.data ?? []}
                        value={settings.allowedSegmentIds}
                        onChange={(next) => onChange({ allowedSegmentIds: next })}
                        disabled={disabled}
                        ariaLabel="Status page allowed segments"
                      />
                    )}
                  </div>
                )}
              </div>
            </label>
          )
        })}
      </RadioGroup>

      <p className="text-xs text-muted-foreground mt-4">
        Your portal&apos;s own access settings still apply first. A private portal never exposes a
        public status page.
      </p>
    </SettingsCard>
  )
}
