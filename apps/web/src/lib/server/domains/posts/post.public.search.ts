/**
 * The portal feed's search mode, settled once per request (see post.search).
 * Its own module, beside post.public.facets, to keep post.public in bounds.
 */
import { db, and, eq, sql, posts, boards } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy'
import { buildPostFilterConditions, type PostListParams } from './post.public'
import { resolvePostSearchMode } from './post.search'

/**
 * Settles whether the request's search needs all its words: when no post in
 * this feed has them all, any one will do. One cheap probe, and only for a
 * search of two or more plain words.
 */
export async function withPublicSearchMode<T extends PostListParams>(
  params: T,
  actor: Actor
): Promise<T> {
  const searchMode = await resolvePostSearchMode(params.search, async () => {
    const rows = await db
      .select({ found: sql<number>`1` })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...buildPostFilterConditions({ ...params, searchMode: 'all' }, actor)))
      .limit(1)
    return rows.length > 0
  })
  return { ...params, searchMode }
}
