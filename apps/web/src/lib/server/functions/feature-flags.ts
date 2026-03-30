import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getFeatureFlags, updateFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const getFeatureFlagsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FeatureFlags> => {
    return getFeatureFlags()
  }
)

export const updateFeatureFlagsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      analytics: z.boolean().optional(),
      helpCenter: z.boolean().optional(),
      aiFeedbackExtraction: z.boolean().optional(),
    })
  )
  .handler(async ({ data }): Promise<FeatureFlags> => {
    return updateFeatureFlags(data)
  })
