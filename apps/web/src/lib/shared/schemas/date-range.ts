import { z } from 'zod'

/**
 * A `[from, to)` reporting window as ISO datetime strings, shared by the
 * analytics server fns (Quinn performance, Quinn tools, SLA/workflow
 * reporting) that all validate the same shape before parsing into `Date`s.
 */
export const dateRangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
})
