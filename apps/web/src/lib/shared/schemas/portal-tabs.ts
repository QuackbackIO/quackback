/**
 * Shared validation schema for portal tab visibility configuration.
 *
 * Mirrors `PortalTabConfig` (apps/web/src/lib/server/domains/portal/types.ts) and
 * is consumed by the REST routes under /api/v1/portal-tabs and the MCP
 * portal-tabs tools so the contract stays single-sourced. All tabs are optional
 * booleans — an absent key falls back to the org/segment default.
 */
import { z } from 'zod'

export const portalTabConfigSchema = z.object({
  feedback: z.boolean().optional(),
  roadmap: z.boolean().optional(),
  changelog: z.boolean().optional(),
  myTickets: z.boolean().optional(),
  helpCenter: z.boolean().optional(),
  support: z.boolean().optional(),
})

export type PortalTabConfigInput = z.infer<typeof portalTabConfigSchema>
