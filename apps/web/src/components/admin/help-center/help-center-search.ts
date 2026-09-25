import { z } from 'zod'

/** The admin help center's URL search params, shared by its route and loader. */
export const helpCenterSearchSchema = z.object({
  status: z.enum(['draft', 'published']).optional().catch(undefined),
  category: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['newest', 'oldest']).optional().catch(undefined),
  deleted: z.boolean().optional().catch(undefined),
  performance: z.boolean().optional().catch(undefined),
})
