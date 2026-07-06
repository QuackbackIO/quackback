/**
 * Shared zod validator for a `conversationId` request field: a syntactically
 * valid conversation TypeID. Previously copy-pasted identically in
 * copilot.ts, transform.ts, and copilot-summary.ts; those now import this
 * instead of re-declaring the same `.refine(isValidTypeId...)` call.
 */
import { z } from 'zod'
import { isValidTypeId } from '@quackback/ids'

export const conversationIdSchema = z
  .string()
  .refine((v) => isValidTypeId(v, 'conversation'), { message: 'Invalid conversation ID format' })
