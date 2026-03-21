import type { SuggestionListItem } from '../feedback-types'

export interface MergePreview {
  title: string
  content?: string | null
  voteCount: number
  commentCount: number
  boardName?: string | null
  statusName?: string | null
  statusColor?: string | null
}

type PostShape = NonNullable<SuggestionListItem['sourcePost']>

/**
 * Computes an approximate merged result from two posts.
 * The canonical post's identity is preserved; vote/comment counts are summed.
 * Actual dedup of shared voters happens server-side — hence the "~" in the UI.
 */
export function computeMergePreview(
  duplicatePost: PostShape,
  canonicalPost: PostShape
): MergePreview {
  return {
    title: canonicalPost.title,
    content: canonicalPost.content,
    voteCount: canonicalPost.voteCount + duplicatePost.voteCount,
    commentCount: (canonicalPost.commentCount ?? 0) + (duplicatePost.commentCount ?? 0),
    boardName: canonicalPost.boardName,
    statusName: canonicalPost.statusName,
    statusColor: canonicalPost.statusColor,
  }
}
