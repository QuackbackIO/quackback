import { Link } from '@tanstack/react-router'
import { AnalyticsBarList } from './analytics-bar-list'
import { AnalyticsEmpty } from './analytics-empty'

interface TopPostsProps {
  posts: Array<{
    rank: number
    postId: string
    title: string
    voteCount: number
    commentCount: number
    boardName: string | null
    statusName: string | null
  }>
}

export function AnalyticsTopPosts({ posts }: TopPostsProps) {
  if (posts.length === 0) {
    return <AnalyticsEmpty message="No posts in this period" />
  }

  return (
    <AnalyticsBarList
      header={{ label: 'Post', value: 'Votes' }}
      rows={posts.map((post) => ({
        key: post.postId,
        value: post.voteCount,
        label: (
          <Link
            to="/admin/feedback"
            search={{ post: post.postId }}
            className="block truncate transition-colors hover:text-primary"
          >
            {post.title}
          </Link>
        ),
      }))}
    />
  )
}
