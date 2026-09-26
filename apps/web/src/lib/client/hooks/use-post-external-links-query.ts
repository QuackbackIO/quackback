/**
 * Query hook for post external links (used by cascade delete dialog).
 */

import { queryOptions, useQuery } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import { fetchPostExternalLinksFn } from '@/lib/server/functions/posts'

export const externalLinksKeys = {
  all: ['post-external-links'] as const,
  byPost: (postId: PostId) => [...externalLinksKeys.all, postId] as const,
}

export function postExternalLinksQuery(postId: PostId) {
  return queryOptions({
    queryKey: externalLinksKeys.byPost(postId),
    queryFn: () => fetchPostExternalLinksFn({ data: { id: postId } }),
    staleTime: 30_000,
  })
}

export function usePostExternalLinks(postId: PostId, enabled: boolean) {
  return useQuery({ ...postExternalLinksQuery(postId), enabled })
}
