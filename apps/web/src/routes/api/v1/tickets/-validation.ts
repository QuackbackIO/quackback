/**
 * Request-body pieces for the ticket write routes. The common wire shapes live
 * in the shared `../-write-validation` module (deduped with the conversation
 * routes); this file re-exports them so the ticket routes import from one place.
 */
export {
  priorityEnum,
  attachmentSchema,
  attachmentsSchema,
  messageContentSchema,
  toAttachments,
  markdownToSanitizedJson,
} from '../-write-validation'
