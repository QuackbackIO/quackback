/** Message-family event declarations (WO-2). created/note_created are workflow triggers. */
import { decl } from './helpers'

const S = 'conversations:read'

export const messageCreated = decl(
  'message.created',
  'conversation_message',
  { webhook: true, workflow: true },
  S
)
export const messageNoteCreated = decl(
  'message.note_created',
  'conversation_message',
  { webhook: true, workflow: true },
  S
)
export const messageDeleted = decl('message.deleted', 'conversation_message', { webhook: true }, S)
