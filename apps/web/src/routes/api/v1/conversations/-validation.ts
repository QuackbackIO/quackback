/**
 * Request-body pieces for the conversation write routes. The common wire shapes
 * live in the shared `../-write-validation` module (deduped with the ticket
 * routes); this file re-exports them and adds the conversation-only status enum.
 */
import { z } from 'zod'
import { CONVERSATION_STATUSES } from '@/lib/shared/db-types'

export {
  priorityEnum,
  attachmentSchema,
  attachmentsSchema,
  messageContentSchema,
  toAttachments,
  markdownToSanitizedJson,
} from '../-write-validation'

export const statusEnum = z.enum(CONVERSATION_STATUSES)
