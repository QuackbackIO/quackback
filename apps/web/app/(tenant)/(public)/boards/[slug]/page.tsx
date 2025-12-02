import { notFound } from 'next/navigation'
import { getCurrentOrganization } from '@/lib/tenant'
import { getPublicBoardBySlug, getPublicPostList, getUserVotedPostIds } from '@quackback/db/queries/public'
import { getUserIdentifier } from '@/lib/user-identifier'
import { PostCard } from '@/components/public/post-card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search } from 'lucide-react'

interface BoardPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    search?: string
    sort?: 'newest' | 'oldest' | 'votes'
    page?: string
  }>
}

/**
 * Public board page with post list
 */
export default async function BoardPage({ params, searchParams }: BoardPageProps) {
  const org = await getCurrentOrganization()
  if (!org) {
    return null
  }

  const { slug } = await params
  const { search, sort = 'newest', page = '1' } = await searchParams

  const board = await getPublicBoardBySlug(org.id, slug)
  if (!board) {
    notFound()
  }

  const userIdentifier = await getUserIdentifier()
  const { items: posts, total, hasMore } = await getPublicPostList({
    boardId: board.id,
    search,
    sort,
    page: parseInt(page),
    limit: 20,
  })

  // Get user's voted posts
  const postIds = posts.map((p) => p.id)
  const votedPostIds = await getUserVotedPostIds(postIds, userIdentifier)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Board header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{board.name}</h1>
        {board.description && (
          <p className="text-muted-foreground">{board.description}</p>
        )}
      </div>

      {/* Search and sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <form className="relative flex-1" method="get">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            name="search"
            placeholder="Search posts..."
            defaultValue={search}
            className="pl-9"
          />
          {/* Preserve sort when searching */}
          <input type="hidden" name="sort" value={sort} />
        </form>

        <form method="get">
          {/* Preserve search when sorting */}
          {search && <input type="hidden" name="search" value={search} />}
          <Select name="sort" defaultValue={sort}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="votes">Most votes</SelectItem>
            </SelectContent>
          </Select>
        </form>
      </div>

      {/* Posts list */}
      {posts.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          {search ? 'No posts match your search.' : 'No posts yet.'}
        </p>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              id={post.id}
              title={post.title}
              content={post.content}
              status={post.status}
              voteCount={post.voteCount}
              commentCount={post.commentCount}
              authorName={post.authorName}
              createdAt={post.createdAt}
              boardSlug={slug}
              tags={post.tags}
              hasVoted={votedPostIds.has(post.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination info */}
      {posts.length > 0 && (
        <div className="mt-6 text-sm text-muted-foreground text-center">
          Showing {posts.length} of {total} posts
          {hasMore && (
            <span>
              {' '}
              ·{' '}
              <a
                href={`?${new URLSearchParams({
                  ...(search ? { search } : {}),
                  sort,
                  page: String(parseInt(page) + 1),
                }).toString()}`}
                className="text-primary hover:underline"
              >
                Load more
              </a>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
