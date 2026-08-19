/**
 * Query options for the post owner (assignee) control, shared by the portal
 * post detail and the admin post modal so both read one cache entry. Every
 * query is permission-gated server-side (post.set_owner) and callers enable it
 * only when the actor holds that key.
 */
import { queryOptions } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import { listOwnerCandidatesFn, getPostOwnerFn } from '@/lib/server/functions/post-owner-context'

export const postOwnerQueries = {
  /** The workspace roster as assignable owners (60s stale — rarely changes). */
  candidates: () =>
    queryOptions({
      queryKey: ['post-owner', 'candidates'] as const,
      queryFn: () => listOwnerCandidatesFn(),
      staleTime: 60_000,
    }),

  /** The current owner of a single post (or null when unassigned). */
  forPost: (postId: PostId) =>
    queryOptions({
      queryKey: ['post-owner', 'forPost', postId] as const,
      queryFn: () => getPostOwnerFn({ data: { postId } }),
      staleTime: 30_000,
    }),
}
