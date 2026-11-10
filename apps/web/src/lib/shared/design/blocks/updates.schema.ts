/** The updates block in the design document; schema.ts hands it the parts every block shares. */
import { z } from 'zod'
import type { BlockSchemaParts } from '../schema'
import { updates } from './updates'

export const updatesSchema = ({ own, linkWords, whenEmpty, shown, countOf }: BlockSchemaParts) =>
  z
    .object({
      type: z.literal('updates'),
      ...own,
      count: countOf(updates.counts.count),
      /** Each entry's date (absent is on) and the start of its words (absent is off). */
      showDate: shown,
      showSummary: shown,
      ...linkWords,
      ...whenEmpty,
    })
    .strict()
