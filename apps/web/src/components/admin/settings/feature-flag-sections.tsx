import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { FEATURE_FLAG_REGISTRY, type FeatureFlags, type LabSectionRow } from '@/lib/shared/types'

export function FeatureFlagSections({
  sections,
  flags,
  pending,
  onToggle,
}: {
  sections: Array<{ title: string; description: string; flags: LabSectionRow[] }>
  flags: FeatureFlags
  pending: boolean
  onToggle: (key: keyof FeatureFlags, value: boolean) => void
}) {
  return (
    <>
      {sections.map((section) => (
        <SettingsCard key={section.title} title={section.title} description={section.description}>
          <div className="divide-y divide-border/50">
            {section.flags.map((row) => {
              const meta = FEATURE_FLAG_REGISTRY[row.key]
              return (
                <div key={row.key} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5 pr-4">
                      <Label
                        htmlFor={`flag-${row.key}`}
                        className="cursor-pointer text-sm font-medium"
                      >
                        {meta.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{meta.description}</p>
                    </div>
                    <Switch
                      id={`flag-${row.key}`}
                      checked={flags[row.key]}
                      onCheckedChange={(checked) => onToggle(row.key, checked)}
                      disabled={pending}
                    />
                  </div>
                  {row.subFlags?.map((subKey) => {
                    const subMeta = FEATURE_FLAG_REGISTRY[subKey]
                    return (
                      <div
                        key={subKey}
                        className="mt-3 ms-1 flex items-center justify-between border-s-2 border-border/50 ps-4"
                      >
                        <div className="space-y-0.5 pr-4">
                          <Label
                            htmlFor={`flag-${subKey}`}
                            className="cursor-pointer text-sm font-medium"
                          >
                            {subMeta.label}
                          </Label>
                          <p className="text-xs text-muted-foreground">{subMeta.description}</p>
                        </div>
                        <Switch
                          id={`flag-${subKey}`}
                          checked={flags[subKey]}
                          onCheckedChange={(checked) => onToggle(subKey, checked)}
                          disabled={pending || !flags[row.key]}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </SettingsCard>
      ))}
    </>
  )
}
