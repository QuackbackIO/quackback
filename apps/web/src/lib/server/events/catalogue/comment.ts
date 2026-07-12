/** Comment-family event declarations (WO-2). */
import { decl } from './helpers'

const S = 'posts:read'

export const commentCreated = decl(
  'comment.created',
  'comment',
  { webhook: true, notification: 'comment' },
  S
)
export const commentUpdated = decl('comment.updated', 'comment', { webhook: true }, S)
export const commentDeleted = decl('comment.deleted', 'comment', { webhook: true }, S)
