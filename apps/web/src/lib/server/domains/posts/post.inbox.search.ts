/**
 * The admin feedback list's search mode, settled once per request (see
 * post.search), the same way the portal feed settles its own.
 */
import { db, and, sql, posts } from '@/lib/server/db'
import { inboxFilterConditions } from './post.inbox'
import { resolvePostSearchMode, type PostSearchMode } from './post.search'
import type { InboxPostListParams } from './post.types'

/**
 * Settles how loosely the request's search matches: every word, half of
 * them, or a close spelling. A search with results costs one LIMIT 1 probe;
 * only one that finds nothing exactly pays for the fallbacks.
 */
export async function withInboxSearchMode<T extends InboxPostListParams>(
  params: T
): Promise<T & { searchMode: PostSearchMode }> {
  const searchMode = await resolvePostSearchMode(params.search, async (mode) => {
    const rows = await db
      .select({ found: sql<number>`1` })
      .from(posts)
      .where(and(...inboxFilterConditions({ ...params, searchMode: mode })))
      .limit(1)
    return rows.length > 0
  })
  return { ...params, searchMode }
}
