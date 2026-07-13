/** Post-family event declarations (WO-2). Exposure authoritative; payloads WO-5. */
import { decl } from './helpers'

const A = 'post_activity'
const S = 'feedback'

export const postCreated = decl('post.created', 'post', { webhook: true, activity: A }, S)
export const postStatusChanged = decl(
  'post.status_changed',
  'post',
  { webhook: true, notification: 'status_change', activity: A },
  S
)
export const postUpdated = decl('post.updated', 'post', { webhook: true, activity: A }, S)
export const postDeleted = decl('post.deleted', 'post', { webhook: true, activity: A }, S)
export const postRestored = decl('post.restored', 'post', { webhook: true, activity: A }, S)
export const postMerged = decl('post.merged', 'post', { webhook: true, activity: A }, S)
export const postUnmerged = decl('post.unmerged', 'post', { webhook: true, activity: A }, S)
export const postMentioned = decl('post.mentioned', 'post', { notification: 'mention' }, S)
