import { z } from 'zod'
import { ACCESS_TIERS } from '@/lib/shared/db-types'

// ============================================
// Roadmap access (single `view` action + segments)
// ============================================
//
// The view-only mirror of boardAccessSchema. Kept alongside the other shared
// schemas (out of `server/`) so client code can import it without dragging the
// @quackback/db/client guard — it imports only zod + @quackback/db/types.

const tierSchema = z.enum(ACCESS_TIERS)

/**
 * Validation for the `RoadmapAccess` payload. A roadmap has a single `view`
 * action, so there are no cross-action tier-rank invariants — the only rule is
 * that selecting the `segments` tier requires a non-empty allowlist (an empty
 * list would hide the roadmap from everyone).
 */
export const roadmapAccessSchema = z
  .object({
    view: tierSchema,
    segments: z.object({
      view: z.array(z.string()).max(50, 'At most 50 segments per roadmap.'),
    }),
  })
  .superRefine((val, ctx) => {
    if (val.view === 'segments' && val.segments.view.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segments', 'view'],
        message: 'Pick at least one segment — an empty allowlist hides the roadmap.',
      })
    }
  })

export type RoadmapAccessInput = z.infer<typeof roadmapAccessSchema>
