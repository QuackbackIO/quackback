/**
 * Pure helpers that turn raw chat `ChatCard`s into display-ready `ChatCardView`s.
 * Kept side-effect free (no DB access) so they're unit-testable in isolation:
 * `collectCardRefs` gathers the post ids a page of cards references, and
 * `buildCardView` assembles one view from the pre-loaded post lookup map.
 */
import type { ChatCard } from '@/lib/shared/db-types'
import type { ChatCardView } from '@/lib/shared/chat/types'

export interface PostRow {
  title: string
  voteCount: number
  statusName: string | null
  statusColor: string | null
  boardSlug: string
  boardName: string
}

/** Gather every post id referenced by a page of cards so the caller can
 *  batch-load them in a single query. */
export function collectCardRefs(cards: ChatCard[]): {
  postIds: Set<string>
} {
  const postIds = new Set<string>()
  for (const card of cards) {
    if (card.type === 'post_ref') postIds.add(card.postId)
  }
  return { postIds }
}

/** Build the display view for a single card from the pre-loaded post lookup
 *  map. Returns null when the referenced post is missing (e.g. deleted) or the
 *  card is an unknown type, so an unrenderable card simply doesn't render. */
export function buildCardView(card: ChatCard, posts: Map<string, PostRow>): ChatCardView | null {
  if (card.type !== 'post_ref') return null
  const post = posts.get(card.postId)
  if (!post) return null
  return {
    type: 'post_ref',
    title: post.title,
    voteCount: post.voteCount,
    statusName: post.statusName,
    statusColor: post.statusColor,
    boardName: post.boardName,
    boardSlug: post.boardSlug,
  }
}
