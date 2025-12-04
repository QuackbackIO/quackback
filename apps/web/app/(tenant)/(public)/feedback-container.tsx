'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { FeedbackHeader } from './feedback-header'
import { FeedbackToolbar } from './feedback-toolbar'
import { FeedbackSidebar } from './feedback-sidebar'
import { PostCard } from '@/components/public/post-card'
import { Button } from '@/components/ui/button'
import type { BoardWithStats, PublicPostListItem } from '@quackback/db/queries/public'
import type { PostStatusEntity } from '@quackback/db'

interface FeedbackContainerProps {
  organizationName: string
  boards: BoardWithStats[]
  posts: PublicPostListItem[]
  statuses: PostStatusEntity[]
  total: number
  hasMore: boolean
  votedPostIds: string[]
  currentBoard?: string
  currentSearch?: string
  currentSort?: 'top' | 'new' | 'trending'
  currentPage: number
  defaultBoardId?: string
}

export function FeedbackContainer({
  organizationName,
  boards,
  posts,
  statuses,
  total,
  hasMore,
  votedPostIds,
  currentBoard,
  currentSearch,
  currentSort = 'top',
  currentPage,
  defaultBoardId,
}: FeedbackContainerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const votedSet = new Set(votedPostIds)

  // Build URL with updated params
  const buildUrl = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString())

      // Reset page when changing filters
      if ('board' in updates || 'search' in updates || 'sort' in updates) {
        params.delete('page')
      }

      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }

      const queryString = params.toString()
      return queryString ? `/?${queryString}` : '/'
    },
    [searchParams]
  )

  const handleBoardChange = useCallback(
    (boardSlug: string | undefined) => {
      router.push(buildUrl({ board: boardSlug }))
    },
    [router, buildUrl]
  )

  const handleSortChange = useCallback(
    (sort: 'top' | 'new' | 'trending') => {
      router.push(buildUrl({ sort }))
    },
    [router, buildUrl]
  )

  const handleSearchChange = useCallback(
    (search: string) => {
      router.push(buildUrl({ search: search || undefined }))
    },
    [router, buildUrl]
  )

  const handleLoadMore = useCallback(() => {
    router.push(buildUrl({ page: String(currentPage + 1) }))
  }, [router, buildUrl, currentPage])

  // Get board ID for creating posts (current board or default)
  const currentBoardInfo = currentBoard ? boards.find((b) => b.slug === currentBoard) : boards[0]
  const boardIdForCreate = currentBoardInfo?.id || defaultBoardId

  return (
    <div className="py-6">
      {/* Main Layout: Content + Sidebar */}
      <div className="flex gap-8">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Header Banner */}
          <FeedbackHeader organizationName={organizationName} />

          {/* Toolbar */}
          <FeedbackToolbar
            currentSort={currentSort}
            currentSearch={currentSearch}
            onSortChange={handleSortChange}
            onSearchChange={handleSearchChange}
            boardId={boardIdForCreate}
          />

          {/* Posts List */}
          <div className="mt-3">
            {posts.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {currentSearch ? 'No posts match your search.' : 'No posts yet.'}
              </p>
            ) : (
              <div className="rounded-lg overflow-hidden divide-y divide-border/50 bg-card shadow-md border border-border/50">
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    id={post.id}
                    title={post.title}
                    content={post.content}
                    status={post.status}
                    statuses={statuses}
                    voteCount={post.voteCount}
                    commentCount={post.commentCount}
                    authorName={post.authorName}
                    createdAt={post.createdAt}
                    boardSlug={post.board?.slug || ''}
                    boardName={post.board?.name}
                    tags={post.tags}
                    hasVoted={votedSet.has(post.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {posts.length > 0 && (
            <div className="mt-6 text-sm text-muted-foreground text-center">
              Showing {posts.length} of {total} posts
              {hasMore && (
                <span>
                  {' · '}
                  <Button variant="link" className="p-0 h-auto" onClick={handleLoadMore}>
                    Load more
                  </Button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <FeedbackSidebar
          boards={boards}
          currentBoard={currentBoard}
          onBoardChange={handleBoardChange}
        />
      </div>
    </div>
  )
}
