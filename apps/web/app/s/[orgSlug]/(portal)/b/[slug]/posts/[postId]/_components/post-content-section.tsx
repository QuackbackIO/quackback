import type { PublicPostDetail } from '@quackback/domain'
import { PostContent } from '@/components/public/post-content'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { Skeleton } from '@/components/ui/skeleton'

export function PostContentSectionSkeleton() {
  return (
    <div className="flex-1 p-6">
      {/* Status skeleton */}
      <Skeleton className="h-5 w-20 mb-3 rounded-full" />

      {/* Title skeleton */}
      <Skeleton className="h-7 w-3/4 mb-2" />

      {/* Author & time skeleton */}
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>

      {/* Tags skeleton */}
      <div className="flex gap-1.5 mb-4">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-18 rounded-full" />
      </div>

      {/* Content skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}

interface PostContentSectionProps {
  post: PublicPostDetail
  currentStatus?: { name: string; color: string | null }
}

export function PostContentSection({ post, currentStatus }: PostContentSectionProps) {
  return (
    <div className="flex-1 p-6">
      {/* Status - only render if status exists */}
      {currentStatus && (
        <StatusBadge name={currentStatus.name} color={currentStatus.color} className="mb-3" />
      )}

      {/* Title */}
      <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">{post.title}</h1>

      {/* Author & time */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <span className="font-medium text-foreground/90">{post.authorName || 'Anonymous'}</span>
        <span className="text-muted-foreground/60">·</span>
        <TimeAgo date={post.createdAt} />
      </div>

      {/* Tags */}
      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {post.tags.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="text-[11px] font-normal">
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Post content */}
      <PostContent
        content={post.content}
        contentJson={post.contentJson}
        className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground/90"
      />
    </div>
  )
}
