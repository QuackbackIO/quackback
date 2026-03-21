/**
 * Query hook for post external links (used by cascade delete dialog).
 */

import { useQuery } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import { fetchPostExternalLinksFn } from '@/lib/server/functions/posts'

export const externalLinksKeys = {
  all: ['post-external-links'] as const,
  byPost: (postId: PostId) => [...externalLinksKeys.all, postId] as const,
}

export function usePostExternalLinks(postId: PostId, enabled: boolean) {
  return useQuery({
    queryKey: externalLinksKeys.byPost(postId),
    queryFn: () => fetchPostExternalLinksFn({ data: { id: postId } }),
    enabled,
    staleTime: 30_000,
  })
}
