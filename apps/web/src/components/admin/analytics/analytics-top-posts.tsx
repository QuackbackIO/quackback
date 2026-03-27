import { Link } from '@tanstack/react-router'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

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
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No posts in this period
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-20 text-right">Votes</TableHead>
          <TableHead className="w-24 text-right">Comments</TableHead>
          <TableHead className="w-28">Board</TableHead>
          <TableHead className="w-28">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((post) => (
          <TableRow key={post.postId}>
            <TableCell className="text-muted-foreground">{post.rank}</TableCell>
            <TableCell>
              <Link
                to="/admin/feedback"
                search={{ post: post.postId }}
                className="font-medium hover:underline"
              >
                {post.title}
              </Link>
            </TableCell>
            <TableCell className="text-right tabular-nums">{post.voteCount}</TableCell>
            <TableCell className="text-right tabular-nums">{post.commentCount}</TableCell>
            <TableCell>
              {post.boardName ? (
                <Badge variant="secondary">{post.boardName}</Badge>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell>
              {post.statusName ? (
                <Badge variant="outline">{post.statusName}</Badge>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
