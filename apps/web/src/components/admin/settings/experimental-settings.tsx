import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_REGISTRY,
  LAB_SECTIONS,
  type FeatureFlags,
} from '@/lib/shared/types'
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
    onError: (error, update) => {
      // Revert optimistic local state for keys in the failed update
      setLocalFlags((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(update) as Array<keyof FeatureFlags>) {
          const attempted = update[key]
          if (typeof attempted === 'boolean') next[key] = !attempted
        }
        return next
      })
      toast.error(error instanceof Error ? error.message : "Couldn't update setting. Try again.")
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
          Try optional AI and analytics features. These stay off until you enable them.
        </p>
      </div>

      {LAB_SECTIONS.map((section) => (
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
                        className="text-sm font-medium cursor-pointer"
                      >
                        {meta.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{meta.description}</p>
                    </div>
                    <Switch
                      id={`flag-${row.key}`}
                      checked={localFlags[row.key]}
                      onCheckedChange={(checked) => handleToggle(row.key, checked)}
                      disabled={mutation.isPending}
                    />
                  </div>
                  {row.subFlags?.map((subKey) => {
                    const subMeta = FEATURE_FLAG_REGISTRY[subKey]
                    return (
                      <div
                        key={subKey}
                        className="mt-3 flex items-center justify-between border-s-2 border-border/50 ps-4 ms-1"
                      >
                        <div className="space-y-0.5 pr-4">
                          <Label
                            htmlFor={`flag-${subKey}`}
                            className="text-sm font-medium cursor-pointer"
                          >
                            {subMeta.label}
                          </Label>
                          <p className="text-xs text-muted-foreground">{subMeta.description}</p>
                        </div>
                        <Switch
                          id={`flag-${subKey}`}
                          checked={localFlags[subKey]}
                          onCheckedChange={(checked) => handleToggle(subKey, checked)}
                          disabled={mutation.isPending || !localFlags[row.key]}
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
    </div>
  )
}
