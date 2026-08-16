import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { FeatureFlagSections } from '@/components/admin/settings/feature-flag-sections'
import { DEFAULT_FEATURE_FLAGS, LAB_SECTIONS, type FeatureFlags } from '@/lib/shared/types'
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
          Try optional connectors and skills. These stay off until you enable them.
        </p>
      </div>

      <FeatureFlagSections
        sections={LAB_SECTIONS}
        flags={localFlags}
        pending={mutation.isPending}
        onToggle={handleToggle}
      />
    </div>
  )
}
