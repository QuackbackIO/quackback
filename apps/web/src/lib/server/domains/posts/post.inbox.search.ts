/**
 * The admin feedback list's search mode, settled once per request (see
 * post.search), the same way the portal feed settles its own.
 */
import { db, and, sql, posts, mergeSuggestions } from '@/lib/server/db'
import { inboxFilterConditions } from './post.inbox'
import { resolvePostSearchMode, type PostSearchMode } from './post.search'
import type { InboxPostListParams } from './post.types'

/** A pending merge suggestion names the post on either side. */
const hasPendingDuplicateSql = sql`EXISTS (SELECT 1 FROM ${mergeSuggestions} WHERE ${mergeSuggestions.status} = 'pending' AND (${mergeSuggestions.sourcePostId} = ${posts.id} OR ${mergeSuggestions.targetPostId} = ${posts.id}))`

/**
 * Settles how loosely the request's search matches: every word, half of
 * them, or a close spelling. A search with results costs one LIMIT 1 probe;
 * only one that finds nothing exactly pays for the fallbacks.
 *
 * `pendingDuplicates` is the list's duplicates filter, which the page applies
 * after it loads; the probe applies it too, so a match the list would hide
 * doesn't stop the search widening.
 */
export async function withInboxSearchMode<T extends InboxPostListParams>(
  params: T,
  { pendingDuplicates = false }: { pendingDuplicates?: boolean } = {}
): Promise<T & { searchMode: PostSearchMode }> {
  const searchMode = await resolvePostSearchMode(params.search, async (mode) => {
    const conditions = inboxFilterConditions({ ...params, searchMode: mode })
    if (pendingDuplicates) conditions.push(hasPendingDuplicateSql)
    const rows = await db
      .select({ found: sql<number>`1` })
      .from(posts)
      .where(and(...conditions))
      .limit(1)
    return rows.length > 0
  })
  return { ...params, searchMode }
}
