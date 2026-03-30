import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  FEATURE_FLAG_REGISTRY,
  type FeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { updateFeatureFlagsFn } from '@/lib/server/functions/feature-flags'

export function ExperimentalSettings() {
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags ?? { analytics: false, helpCenter: false }
  const [localFlags, setLocalFlags] = useState<FeatureFlags>(flags as FeatureFlags)
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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Experimental Features</h2>
        <p className="text-sm text-muted-foreground mt-1">
          These features are in development and may change or be removed.
        </p>
      </div>

      <div className="space-y-4">
        {(Object.keys(FEATURE_FLAG_REGISTRY) as Array<keyof FeatureFlags>).map((key) => {
          const meta = FEATURE_FLAG_REGISTRY[key]
          return (
            <Card key={key}>
              <CardContent className="flex items-center justify-between py-4">
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
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
