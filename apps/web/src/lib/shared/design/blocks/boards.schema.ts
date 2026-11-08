/** The boards block in the design document; schema.ts hands it the parts every block shares. */
import { z } from 'zod'
import type { BlockSchemaParts } from '../schema'

export const boardsSchema = ({ own, linkWords, shown }: BlockSchemaParts) =>
  z
    .object({
      type: z.literal('boards'),
      ...own,
      /** How many posts each board has; absent is on. */
      showCounts: shown,
      ...linkWords,
    })
    .strict()
