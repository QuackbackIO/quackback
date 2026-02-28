import { SidebarPostRow, type PostRowData } from './sidebar-post-row'

interface LinkedPostData extends PostRowData {
  linkId: string
}

interface SidebarLinkedPostsProps {
  posts: LinkedPostData[]
  onUnlink: (postId: string) => Promise<void>
}

export function SidebarLinkedPosts({ posts, onUnlink }: SidebarLinkedPostsProps) {
  if (posts.length === 0) return null

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Linked to this ticket
      </h3>
      <div className="space-y-2">
        {posts.map((post) => (
          <SidebarPostRow
            key={post.id}
            post={post}
            linked
            onUnlink={() => onUnlink(post.id)}
          />
        ))}
      </div>
    </div>
  )
}
