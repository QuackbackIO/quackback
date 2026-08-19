import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { updateFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/server/domains/settings/settings.types'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

// The schema is derived from the flag registry: an enumerated list here once
// silently stripped newer flags from the request (zod drops unknown keys),
// making their Labs toggles no-ops.
const featureFlagsUpdateSchema = z.object(
  Object.fromEntries(
    Object.keys(DEFAULT_FEATURE_FLAGS).map((key) => [key, z.boolean().optional()])
  ) as Record<keyof FeatureFlags, z.ZodOptional<z.ZodBoolean>>
)

// Admin-only: feature flags toggle whole subsystems that change the
// public surface (helpCenter exposes a public subdomain) and the data
// flow (inboxAi routes customer text through an LLM).
// Without a role gate any unauthenticated RPC caller could flip these.
export const updateFeatureFlagsFn = createServerFn({ method: 'POST' })
  .validator(featureFlagsUpdateSchema)
  .handler(async ({ data }): Promise<FeatureFlags> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return updateFeatureFlags(data)
  })
