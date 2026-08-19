import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import type { ConversationId } from '@quackback/ids'
import { getLinkedPostsForConversationFn } from '@/lib/server/functions/conversation'

/**
 * Posts this conversation was converted into (read-only). Renders nothing when
 * there are no links, so it's safe to drop into the sidebar unconditionally.
 */
export function LinkedPosts({ conversationId }: { conversationId: ConversationId }) {
  const { data: posts } = useQuery({
    queryKey: ['admin', 'inbox', 'linked-posts', conversationId],
    queryFn: () => getLinkedPostsForConversationFn({ data: { conversationId } }),
    staleTime: 30_000,
  })

  if (!posts || posts.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-muted-foreground">Linked posts</p>
      {posts.map((post) => (
        <Link
          key={post.postId}
          to="/b/$slug/posts/$postId"
          params={{ slug: post.boardSlug, postId: post.postId }}
          className="group inline-flex items-center gap-1 truncate text-xs text-foreground/80 transition-colors hover:text-primary"
        >
          <span className="truncate">{post.title}</span>
          <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </Link>
      ))}
    </div>
  )
}
