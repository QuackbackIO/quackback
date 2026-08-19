/**
 * Query options for the portal vote-management tools (voters list). Read from
 * the post.vote_on_behalf-gated fn so a portal team member who can manage votes
 * can populate the voters stack + modal without holding the broader
 * post.view_private that the admin voters query requires. Callers enable it
 * only when the actor holds post.vote_on_behalf.
 */
import { queryOptions, type UseQueryOptions } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import { listPostVotersForVoteManagerFn } from '@/lib/server/functions/post-voters-context'

/** A single voter row as returned to a vote manager on the portal. */
export type PostVoterRow = Awaited<ReturnType<typeof listPostVotersForVoteManagerFn>>[number]

/**
 * A voters query source (admin or portal). Both fns return the same row shape,
 * so the shared voters stack + modal read either interchangeably; the only
 * difference is the permission gate baked into the query's fn.
 */
export type VotersQuerySource = UseQueryOptions<PostVoterRow[], Error, PostVoterRow[], string[]>

export const postVotersQueries = {
  /** Voters for a single post, for the portal vote-management tools. */
  forPost: (postId: PostId): VotersQuerySource =>
    queryOptions({
      queryKey: ['post-voters', postId],
      queryFn: () => listPostVotersForVoteManagerFn({ data: { postId } }),
      staleTime: 30_000,
    }),
}
