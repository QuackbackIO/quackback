/** The help_search block in the design document; schema.ts hands it the parts every block shares. */
import { z } from 'zod'
import type { BlockSchemaParts } from '../schema'
import { helpSearch } from './help-search'

export const helpSearchSchema = ({ own, linkWords, countOf }: BlockSchemaParts) =>
  z
    .object({
      type: z.literal('help_search'),
      ...own,
      /** How many popular articles it lists under the search; absent is 5. */
      popular: countOf(helpSearch.counts.popular).optional(),
      ...linkWords,
    })
    .strict()
