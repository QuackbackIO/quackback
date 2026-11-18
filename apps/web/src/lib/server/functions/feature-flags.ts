import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { updateFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import {
  DEFAULT_FEATURE_FLAGS,
  ROLLOUT_FEATURE_FLAGS,
} from '@/lib/server/domains/settings/settings.types'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

type WorkspaceFlag = Exclude<keyof FeatureFlags, (typeof ROLLOUT_FEATURE_FLAGS)[number]>

// The schema is derived from DEFAULT_FEATURE_FLAGS: an enumerated list here
// once silently stripped newer flags from the request (zod drops unknown keys),
// making their Settings → General toggles no-ops. Operator rollout flags are
// left out, so zod drops them and a workspace cannot change them.
export const featureFlagsUpdateSchema = z.object(
  Object.fromEntries(
    Object.keys(DEFAULT_FEATURE_FLAGS)
      .filter((key) => !(ROLLOUT_FEATURE_FLAGS as readonly string[]).includes(key))
      .map((key) => [key, z.boolean().optional()])
  ) as Record<WorkspaceFlag, z.ZodOptional<z.ZodBoolean>>
)

// Admin-only: feature flags toggle whole product subsystems that change the
// public surface (helpCenter exposes a public subdomain). Without a role gate
// any unauthenticated RPC caller could flip these.
export const updateFeatureFlagsFn = createServerFn({ method: 'POST' })
  .validator(featureFlagsUpdateSchema)
  .handler(async ({ data }): Promise<FeatureFlags> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return updateFeatureFlags(data)
  })
