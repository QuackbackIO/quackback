/** Comment-family event declarations (WO-2). */
import { decl } from './helpers'

const S = 'feedback'

export const commentCreated = decl(
  'comment.created',
  'post_comment',
  { webhook: true, notification: 'comment' },
  S
)
export const commentUpdated = decl('comment.updated', 'post_comment', { webhook: true }, S)
export const commentDeleted = decl('comment.deleted', 'post_comment', { webhook: true }, S)
