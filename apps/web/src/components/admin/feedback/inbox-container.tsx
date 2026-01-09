import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { InboxFiltersPanel } from '@/components/admin/feedback/inbox-filters'
import { InboxPostList } from '@/components/admin/feedback/inbox-post-list'
import { InboxPostDetail } from '@/components/admin/feedback/inbox-post-detail'
import { CreatePostDialog } from '@/components/admin/feedback/create-post-dialog'
import { EditPostDialog } from '@/components/admin/feedback/edit-post-dialog'
import { useInboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import {
  useInboxPosts,
  usePostDetail,
  useUpdatePostStatus,
  useUpdatePostTags,
  useUpdateOfficialResponse,
  useToggleCommentReaction,
  useVotePost,
  useAddComment,
  flattenInboxPosts,
  inboxKeys,
} from '@/lib/hooks/use-inbox-queries'
import { useInboxUIStore } from '@/lib/stores/inbox-ui'
import type { CommentId, PostId, StatusId } from '@quackback/ids'
import type { CurrentUser } from '@/components/admin/feedback/inbox-types'
import type { Board, Tag, InboxPostListResult, PostStatusEntity } from '@/lib/db-types'
import type { TeamMember } from '@/lib/members'

interface InboxContainerProps {
  initialPosts: InboxPostListResult
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
  currentUser: CurrentUser
}

export function InboxContainer({
  initialPosts,
  boards,
  tags,
  statuses,
  members,
  currentUser,
}: InboxContainerProps) {
  const queryClient = useQueryClient()

  // URL-based filter state
  const {
    filters,
    setFilters,
    clearFilters,
    selectedPostId,
    setSelectedPostId,
    hasActiveFilters,
    toggleBoard,
    toggleStatus,
  } = useInboxFilters()

  // UI state from Zustand
  const { isEditDialogOpen, setEditDialogOpen } = useInboxUIStore()

  // Track whether we're on the initial render (for using server-prefetched data)
  const isInitialRender = useRef(true)

  // Mark as no longer initial after first render
  useEffect(() => {
    isInitialRender.current = false
  }, [])

  // Only use initialData on first render before any filter changes
  // This prevents stale data when user changes filters
  const shouldUseInitialData = isInitialRender.current && !filters.search && !filters.owner

  // Server state - Posts list (with infinite query for pagination)
  const {
    data: postsData,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = useInboxPosts({
    filters,
    initialData: shouldUseInitialData ? initialPosts : undefined,
  })

  const posts = flattenInboxPosts(postsData)

  // Server state - Selected post detail
  const { data: selectedPost, isLoading: isLoadingPost } = usePostDetail({
    postId: selectedPostId as PostId | null,
  })

  // Mutations
  const updateStatus = useUpdatePostStatus()
  const updateTags = useUpdatePostTags()
  const updateOfficialResponse = useUpdateOfficialResponse()
  const toggleReaction = useToggleCommentReaction()
  const votePost = useVotePost()
  const addComment = useAddComment()

  // Handlers
  const handleLoadMore = () => {
    if (hasMore && !isLoadingMore) {
      fetchNextPage()
    }
  }

  const handleStatusChange = async (statusId: StatusId) => {
    if (!selectedPostId) return
    updateStatus.mutate({ postId: selectedPostId as PostId, statusId })
  }

  const handleTagsChange = async (tagIds: string[]) => {
    if (!selectedPostId) return
    updateTags.mutate({ postId: selectedPostId as PostId, tagIds, allTags: tags })
  }

  const handleOfficialResponseChange = async (response: string | null) => {
    if (!selectedPostId) return
    updateOfficialResponse.mutate({ postId: selectedPostId as PostId, response })
  }

  const handleReaction = (commentId: string, emoji: string) => {
    if (!selectedPostId) return
    toggleReaction.mutate({
      postId: selectedPostId as PostId,
      commentId: commentId as CommentId,
      emoji,
    })
  }

  const handleVote = () => {
    if (!selectedPostId) return
    votePost.mutate(selectedPostId as PostId)
  }

  const refetchPosts = () => {
    queryClient.invalidateQueries({
      queryKey: inboxKeys.list(filters),
    })
  }

  return (
    <>
      <InboxLayout
        hasActiveFilters={hasActiveFilters}
        filters={
          <InboxFiltersPanel
            filters={filters}
            onFiltersChange={setFilters}
            boards={boards}
            tags={tags}
            statuses={statuses}
          />
        }
        postList={
          <InboxPostList
            posts={posts}
            statuses={statuses}
            boards={boards}
            tags={tags}
            members={members}
            filters={filters}
            onFiltersChange={setFilters}
            hasMore={!!hasMore}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            selectedPostId={selectedPostId}
            onSelectPost={setSelectedPostId}
            onLoadMore={handleLoadMore}
            sort={filters.sort}
            onSortChange={(sort) => setFilters({ sort })}
            search={filters.search}
            onSearchChange={(search) => setFilters({ search })}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            onToggleStatus={toggleStatus}
            onToggleBoard={toggleBoard}
            headerAction={
              <CreatePostDialog
                boards={boards}
                tags={tags}
                statuses={statuses}
                onPostCreated={refetchPosts}
              />
            }
          />
        }
        postDetail={
          <InboxPostDetail
            post={selectedPost ?? null}
            isLoading={isLoadingPost}
            allTags={tags}
            statuses={statuses}
            avatarUrls={selectedPost?.avatarUrls}
            currentUser={currentUser}
            onClose={() => setSelectedPostId(null)}
            onEdit={() => setEditDialogOpen(true)}
            onStatusChange={handleStatusChange}
            onTagsChange={handleTagsChange}
            onOfficialResponseChange={handleOfficialResponseChange}
            onRoadmapChange={() => {
              if (selectedPostId) {
                queryClient.invalidateQueries({
                  queryKey: inboxKeys.detail(selectedPostId as PostId),
                })
              }
            }}
            createComment={addComment}
            onReaction={handleReaction}
            isReactionPending={toggleReaction.isPending}
            onVote={handleVote}
            isVotePending={votePost.isPending}
          />
        }
      />

      {/* Edit Post Dialog */}
      {selectedPost && (
        <EditPostDialog
          post={selectedPost}
          boards={boards}
          tags={tags}
          statuses={statuses}
          open={isEditDialogOpen}
          onOpenChange={setEditDialogOpen}
        />
      )}
    </>
  )
}
