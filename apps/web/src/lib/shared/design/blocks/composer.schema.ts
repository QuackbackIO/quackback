/** The composer block in the design document; schema.ts hands it the parts every block shares. */
import { z } from 'zod'
import type { BlockSchemaParts } from '../schema'

export const composerSchema = ({ own }: BlockSchemaParts) =>
  z.object({ type: z.literal('composer'), ...own }).strict()
