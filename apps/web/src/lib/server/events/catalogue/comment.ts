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
// Notification-only: the mentioned person's bell and email. Never a webhook,
// so a private comment's words never leave.
export const commentMentioned = decl(
  'comment.mentioned',
  'post_comment',
  { notification: 'mention' },
  S
)
