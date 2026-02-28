import { SidebarPostRow, type PostRowData } from './sidebar-post-row'
import { Skeleton } from '@/components/ui/skeleton'

interface SidebarSuggestionsProps {
  posts: PostRowData[]
  linkedPostIds: Set<string>
  loading: boolean
  onLink: (postId: string) => Promise<void>
  label?: string
}

export function SidebarSuggestions({
  posts,
  linkedPostIds,
  loading,
  onLink,
  label = 'Suggested matches',
}: SidebarSuggestionsProps) {
  if (loading) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (posts.length === 0) return null

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <div className="space-y-2">
        {posts.map((post) => {
          const isLinked = linkedPostIds.has(post.id)
          return (
            <SidebarPostRow
              key={post.id}
              post={post}
              linked={isLinked}
              onLink={isLinked ? undefined : () => onLink(post.id)}
            />
          )
        })}
      </div>
    </div>
  )
}
