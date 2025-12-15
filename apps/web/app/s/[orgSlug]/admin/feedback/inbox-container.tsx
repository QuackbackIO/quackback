'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { InboxLayout } from './inbox-layout'
import { InboxFiltersPanel } from './inbox-filters'
import { InboxPostList } from './inbox-post-list'
import { InboxPostDetail } from './inbox-post-detail'
import { CreatePostDialog } from './create-post-dialog'
import { EditPostDialog } from './edit-post-dialog'
import { useInboxFilters } from './use-inbox-filters'
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
import type { StatusId } from '@quackback/ids'
import type { CurrentUser } from './inbox-types'
import type { Board, Tag, InboxPostListResult, PostStatusEntity } from '@quackback/db/types'
import type { TeamMember } from '@quackback/domain'

interface InboxContainerProps {
  organizationId: string
  initialPosts: InboxPostListResult
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
  currentUser: CurrentUser
}

export function InboxContainer({
  organizationId,
  initialPosts,
  boards,
  tags,
  statuses,
  members,
  currentUser,
}: InboxContainerProps) {
  const queryClient = useQueryClient()

  // URL-based filter state (unchanged)
  const {
    filters,
    setFilters,
    clearFilters,
    selectedPostId,
    setSelectedPostId: setSelectedPostIdAsync,
    hasActiveFilters,
  } = useInboxFilters()

  // Simple wrapper - nuqs returns Promise but we don't need to await
  const setSelectedPostId = (id: string | null) => void setSelectedPostIdAsync(id)

  // UI state from Zustand
  const { isEditDialogOpen, setEditDialogOpen } = useInboxUIStore()

  // Track if defaults have been initialized
  const hasInitializedDefaults = useRef(false)

  // Track whether we're on the initial render (no URL filters yet)
  const isInitialRender = useRef(true)

  // Initialize default filters (all boards and statuses selected) on first mount
  useEffect(() => {
    if (hasInitializedDefaults.current) return
    hasInitializedDefaults.current = true

    // Only set defaults if no board/status filters are in URL
    const hasNoFiltersInUrl = !filters.board?.length && !filters.status?.length

    if (hasNoFiltersInUrl && boards.length > 0 && statuses.length > 0) {
      setFilters({
        board: boards.map((b) => b.id),
        status: statuses.map((s) => s.slug),
      })
    }

    // After first render, mark as no longer initial
    isInitialRender.current = false
  }, [boards, statuses, filters.board, filters.status, setFilters])

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
    organizationId,
    filters,
    initialData: shouldUseInitialData ? initialPosts : undefined,
  })

  const posts = flattenInboxPosts(postsData)

  // Server state - Selected post detail
  const { data: selectedPost, isLoading: isLoadingPost } = usePostDetail({
    postId: selectedPostId,
    organizationId,
  })

  // Mutations
  const updateStatus = useUpdatePostStatus(organizationId)
  const updateTags = useUpdatePostTags(organizationId)
  const updateOfficialResponse = useUpdateOfficialResponse(organizationId)
  const toggleReaction = useToggleCommentReaction(organizationId)
  const votePost = useVotePost(organizationId)
  const addComment = useAddComment(organizationId)

  // Handlers
  const handleLoadMore = () => {
    if (hasMore && !isLoadingMore) {
      fetchNextPage()
    }
  }

  const handleStatusChange = async (statusId: StatusId) => {
    if (!selectedPostId) return
    updateStatus.mutate({ postId: selectedPostId, statusId })
  }

  const handleTagsChange = async (tagIds: string[]) => {
    if (!selectedPostId) return
    updateTags.mutate({ postId: selectedPostId, tagIds, allTags: tags })
  }

  const handleOfficialResponseChange = async (response: string | null) => {
    if (!selectedPostId) return
    updateOfficialResponse.mutate({ postId: selectedPostId, response })
  }

  const handleReaction = (commentId: string, emoji: string) => {
    if (!selectedPostId) return
    toggleReaction.mutate({ postId: selectedPostId, commentId, emoji })
  }

  const handleVote = () => {
    if (!selectedPostId) return
    votePost.mutate(selectedPostId)
  }

  const refetchPosts = () => {
    queryClient.invalidateQueries({
      queryKey: inboxKeys.list(organizationId, filters),
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
            members={members}
          />
        }
        postList={
          <InboxPostList
            posts={posts}
            statuses={statuses}
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
            headerAction={
              <CreatePostDialog
                organizationId={organizationId}
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
            organizationId={organizationId}
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
                  queryKey: inboxKeys.detail(selectedPostId, organizationId),
                })
              }
            }}
            submitComment={addComment.mutateAsync}
            isCommentPending={addComment.isPending}
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
          organizationId={organizationId}
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
