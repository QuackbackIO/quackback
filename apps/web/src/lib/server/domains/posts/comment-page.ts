/**
 * Comment pagination primitives shared by the public detail and admin comment
 * query paths.
 *
 * Comments are paginated by TOP-LEVEL (root) comment, keyset on
 * `(created_at, id)` ascending. Each returned root carries its full reply
 * subtree — reply chains are shallow in practice, so bounding the number of
 * roots bounds the payload. The keyset cursor (createdAt + id) makes paging
 * deterministic across ties and stable under concurrent inserts.
 */
import type { CommentCursor } from './post.types'

/** Default number of root comments returned per page on the portal/widget. */
export const DEFAULT_COMMENT_PAGE_SIZE = 30

/** Smaller default for the constrained widget viewport. */
export const WIDGET_COMMENT_PAGE_SIZE = 15

/**
 * Encode a keyset cursor as `<createdAtISO>|<uuid>`. The pipe is safe because
 * neither an ISO timestamp nor a UUID contains one.
 */
export function encodeCommentCursor(createdAt: Date | string, id: string): string {
  const iso = typeof createdAt === 'string' ? createdAt : createdAt.toISOString()
  return `${iso}|${id}`
}

/**
 * Decode a cursor produced by {@link encodeCommentCursor}. Returns null for
 * missing/malformed input so a bad client cursor degrades to "first page"
 * rather than throwing.
 */
export function decodeCommentCursor(cursor: string | null | undefined): CommentCursor | null {
  if (!cursor) return null
  const sep = cursor.indexOf('|')
  if (sep <= 0) return null
  const createdAt = cursor.slice(0, sep)
  const id = cursor.slice(sep + 1)
  if (!createdAt || !id) return null
  const ts = new Date(createdAt)
  if (Number.isNaN(ts.getTime())) return null
  return { createdAt, id }
}
