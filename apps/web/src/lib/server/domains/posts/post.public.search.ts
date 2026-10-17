/**
 * The portal feed's search mode, settled once per request (see post.search).
 * Its own module, beside post.public.facets, to keep post.public in bounds.
 */
import { db, and, eq, sql, posts, boards } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy'
import { buildPostFilterConditions, type PostListParams } from './post.public'
import { resolvePostSearchMode, type PostSearchMode } from './post.search'

/**
 * Settles how loosely the request's search matches (see
 * resolvePostSearchMode): every word, half of them, or a close spelling. A
 * search with results costs one LIMIT 1 probe; only one that finds nothing
 * exactly pays for the fallbacks.
 */
export async function withPublicSearchMode<T extends PostListParams>(
  params: T,
  actor: Actor
): Promise<T & { searchMode: PostSearchMode }> {
  const searchMode = await resolvePostSearchMode(params.search, async (mode) => {
    const rows = await db
      .select({ found: sql<number>`1` })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...buildPostFilterConditions({ ...params, searchMode: mode }, actor)))
      .limit(1)
    return rows.length > 0
  })
  return { ...params, searchMode }
}
