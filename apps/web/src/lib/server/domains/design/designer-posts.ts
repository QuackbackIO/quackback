/**
 * The posts the designer offers to show as its post page: the top ones a
 * signed-out visitor can open, whoever is designing. A post on a board only
 * signed-in visitors, a segment or the team may see is never among them.
 */
import { ANONYMOUS_ACTOR } from '@/lib/server/policy'
import { listPublicPosts } from '@/lib/server/domains/posts/post.public'

export interface DesignerPost {
  id: string
  title: string
  /** The post's own address in the portal. */
  path: string
}

/** How many the item picker lists; it has no search yet. */
export const DESIGNER_POST_LIMIT = 12

export async function listDesignerPosts(): Promise<DesignerPost[]> {
  const { items } = await listPublicPosts({
    sort: 'top',
    page: 1,
    limit: DESIGNER_POST_LIMIT,
    actor: ANONYMOUS_ACTOR,
  })
  return items.flatMap((item) =>
    item.board?.slug
      ? [{ id: item.id, title: item.title, path: `/b/${item.board.slug}/posts/${item.id}` }]
      : []
  )
}
