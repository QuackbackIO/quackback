import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { FEATURE_FLAG_REGISTRY, LAB_SECTIONS, type FeatureFlags } from '@/lib/shared/types'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/server/domains/settings/settings.types'
import { updateFeatureFlagsFn } from '@/lib/server/functions/feature-flags'

export function ExperimentalSettings() {
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = (settings?.featureFlags as FeatureFlags | undefined) ?? DEFAULT_FEATURE_FLAGS
  const [localFlags, setLocalFlags] = useState<FeatureFlags>(flags)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (update: Partial<FeatureFlags>) => updateFeatureFlagsFn({ data: update }),
    onSuccess: () => {
      queryClient.invalidateQueries()
      // Invalidate the router to refresh bootstrap data
      window.location.reload()
    },
  })

  const handleToggle = (key: keyof FeatureFlags, value: boolean) => {
    setLocalFlags((prev) => ({ ...prev, [key]: value }))
    mutation.mutate({ [key]: value })
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold">Labs</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Turn experimental features on or off. They are still in development, so they may change or
          be removed.
        </p>
      </div>

      {LAB_SECTIONS.map((section) => (
        <SettingsCard key={section.title} title={section.title} description={section.description}>
          <div className="divide-y divide-border/50">
            {section.flags.map((key) => {
              const meta = FEATURE_FLAG_REGISTRY[key]
              return (
                <div
                  key={key}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5 pr-4">
                    <Label htmlFor={`flag-${key}`} className="text-sm font-medium cursor-pointer">
                      {meta.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                  </div>
                  <Switch
                    id={`flag-${key}`}
                    checked={localFlags[key]}
                    onCheckedChange={(checked) => handleToggle(key, checked)}
                    disabled={mutation.isPending}
                  />
                </div>
              )
            })}
          </div>
        </SettingsCard>
      ))}
    </div>
  )
}
