/** The status block in the design document; schema.ts hands it the parts every block shares. */
import { z } from 'zod'
import type { BlockSchemaParts } from '../schema'

export const statusSchema = ({ own, linkWords, whenEmpty, shown }: BlockSchemaParts) =>
  z
    .object({
      type: z.literal('status'),
      ...own,
      /** The incidents under way, under the status; absent is on. */
      showIncidents: shown,
      ...linkWords,
      ...whenEmpty,
    })
    .strict()
