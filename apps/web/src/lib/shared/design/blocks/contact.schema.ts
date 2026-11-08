/** The contact block in the design document; schema.ts hands it the parts every block shares. */
import { z } from 'zod'
import type { BlockSchemaParts } from '../schema'

export const contactSchema = ({ own, linkWords, localizedUpTo }: BlockSchemaParts) =>
  z
    .object({
      type: z.literal('contact'),
      ...own,
      /** Its line of words; absent is its usual one. */
      text: localizedUpTo(160).optional(),
      ...linkWords,
    })
    .strict()
