/**
 * Shared validation schema for changelog visibility configuration.
 *
 * Mirrors `ChangelogVisibilityConfig` (packages/db/src/schema/changelog.ts) and
 * is consumed by the REST routes under /api/v1/changelog/visibility and the MCP
 * changelog-visibility tools so the contract stays single-sourced.
 */
import { z } from 'zod'

export const changelogVisibilityConfigSchema = z.object({
  restrictCategories: z.boolean().optional(),
  allowedCategoryIds: z.array(z.string()).max(500).optional(),
  restrictProducts: z.boolean().optional(),
  allowedProductIds: z.array(z.string()).max(500).optional(),
})

export type ChangelogVisibilityConfigInput = z.infer<typeof changelogVisibilityConfigSchema>
