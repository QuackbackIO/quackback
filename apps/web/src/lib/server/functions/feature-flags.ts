import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { updateFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

// Admin-only: feature flags toggle whole subsystems that change the
// public surface (helpCenter exposes a public subdomain) and the data
// flow (aiFeedbackExtraction routes customer text through an LLM).
// Without a role gate any unauthenticated RPC caller could flip these.
export const updateFeatureFlagsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      analytics: z.boolean().optional(),
      helpCenter: z.boolean().optional(),
      aiFeedbackExtraction: z.boolean().optional(),
      tickets: z.boolean().optional(),
    })
  )
  .handler(async ({ data }): Promise<FeatureFlags> => {
    await requireAuth({ roles: ['admin'] })
    return updateFeatureFlags(data)
  })
