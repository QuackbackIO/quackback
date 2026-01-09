import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { DetailHeader } from './detail-header'
import { DetailContent } from './detail-content'
import { DetailProperties } from './detail-properties'
import { EditPostDialog } from '@/components/admin/feedback/edit-post-dialog'
import { useInboxUIStore } from '@/lib/stores/inbox-ui'
import {
  useUpdatePostStatus,
  useUpdatePostTags,
  useUpdateOfficialResponse,
  useToggleCommentReaction,
  useVotePost,
  useAddComment,
  inboxKeys,
} from '@/lib/hooks/use-inbox-queries'
import type { PostDetails, CurrentUser } from '@/components/admin/feedback/inbox-types'
import type { Board, Tag, PostStatusEntity } from '@/lib/db-types'
import type { TeamMember } from '@/lib/members'
import type { CommentId, PostId, StatusId, TagId } from '@quackback/ids'
import { useNavigationContext } from './use-navigation-context'

interface FeedbackDetailPageProps {
  post: PostDetails
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
  currentUser: CurrentUser
}

function _DetailSkeleton() {
  return (
    <div className="flex h-full bg-background">
      {/* Sidebar skeleton - left aligned */}
      <div className="hidden lg:block w-64 xl:w-72 border-r border-border/40 bg-gradient-to-b from-card/50 to-card/30 p-5 space-y-6">
        {/* Properties section */}
        <div className="space-y-4">
          <Skeleton className="h-3 w-20" />
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-2.5 w-10" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-2.5 w-8" />
              <div className="flex gap-1.5">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-12 rounded-full" />
              </div>
            </div>
          </div>
        </div>
        {/* Author section */}
        <div className="border-t border-border/30 pt-6 space-y-3">
          <Skeleton className="h-3 w-14" />
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/25">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
        </div>
        {/* Stats section */}
        <div className="border-t border-border/30 pt-6 space-y-3">
          <Skeleton className="h-3 w-20" />
          <div className="grid grid-cols-2 gap-2.5">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        </div>
      </div>
      {/* Main content skeleton */}
      <div className="flex-1 min-w-0">
        {/* Header skeleton */}
        <div className="border-b border-border/40 px-4 py-2.5 bg-gradient-to-b from-card/98 to-card/95">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-7 w-20 rounded-lg" />
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
        </div>
        {/* Content skeleton */}
        <div className="flex border-b border-border/30">
          <div className="w-20 border-r border-border/30 bg-muted/10 py-6 px-4 flex justify-center">
            <Skeleton className="h-16 w-12 rounded-xl" />
          </div>
          <div className="flex-1 p-6 space-y-5">
            <Skeleton className="h-7 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function FeedbackDetailPage({
  post,
  boards,
  tags,
  statuses,
  members: _members,
  currentUser,
}: FeedbackDetailPageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Navigation context from sessionStorage (client-side only)
  const navigationContext = useNavigationContext(post.id)

  // UI state
  const { isEditDialogOpen, setEditDialogOpen } = useInboxUIStore()
  const [isUpdating, setIsUpdating] = useState(false)

  // Mutations
  const updateStatus = useUpdatePostStatus()
  const updateTags = useUpdatePostTags()
  const updateOfficialResponse = useUpdateOfficialResponse()
  const toggleReaction = useToggleCommentReaction()
  const votePost = useVotePost()
  const addComment = useAddComment()

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'j':
          e.preventDefault()
          if (navigationContext.nextId) {
            // Just navigate to the post - sessionStorage has the full list for context
            navigate({
              to: '/admin/feedback/posts/$postId',
              params: { postId: navigationContext.nextId },
            })
          }
          break
        case 'k':
          e.preventDefault()
          if (navigationContext.prevId) {
            // Just navigate to the post - sessionStorage has the full list for context
            navigate({
              to: '/admin/feedback/posts/$postId',
              params: { postId: navigationContext.prevId },
            })
          }
          break
        case 'Escape':
          navigate({ to: navigationContext.backUrl as any })
          break
        case 'e':
          e.preventDefault()
          setEditDialogOpen(true)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigationContext, navigate, setEditDialogOpen])

  // Handlers
  const handleStatusChange = async (statusId: StatusId) => {
    setIsUpdating(true)
    try {
      await updateStatus.mutateAsync({ postId: post.id as PostId, statusId })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleTagsChange = async (tagIds: TagId[]) => {
    setIsUpdating(true)
    try {
      await updateTags.mutateAsync({ postId: post.id as PostId, tagIds, allTags: tags })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleOfficialResponseChange = async (response: string | null) => {
    setIsUpdating(true)
    try {
      await updateOfficialResponse.mutateAsync({ postId: post.id as PostId, response })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleReaction = (commentId: string, emoji: string) => {
    toggleReaction.mutate({
      postId: post.id as PostId,
      commentId: commentId as CommentId,
      emoji,
    })
  }

  const handleVote = () => {
    votePost.mutate(post.id as PostId)
  }

  const handleRoadmapChange = () => {
    queryClient.invalidateQueries({
      queryKey: inboxKeys.detail(post.id as PostId),
    })
  }

  return (
    <>
      <div className="flex flex-col lg:flex-row h-full bg-background">
        {/* Properties sidebar - left aligned */}
        <DetailProperties
          post={post}
          boards={boards}
          tags={tags}
          statuses={statuses}
          avatarUrls={post.avatarUrls}
          onStatusChange={handleStatusChange}
          onTagsChange={handleTagsChange}
          isUpdating={isUpdating}
        />

        {/* Main content area */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <DetailHeader
            post={post}
            statuses={statuses}
            navigationContext={navigationContext}
            onEdit={() => setEditDialogOpen(true)}
            onRoadmapChange={handleRoadmapChange}
          />
          <DetailContent
            post={post}
            avatarUrls={post.avatarUrls}
            currentUser={currentUser}
            createComment={addComment}
            onReaction={handleReaction}
            isReactionPending={toggleReaction.isPending}
            onVote={handleVote}
            isVotePending={votePost.isPending}
            onOfficialResponseChange={handleOfficialResponseChange}
            isUpdating={isUpdating}
          />
        </div>
      </div>

      {/* Edit dialog */}
      <EditPostDialog
        post={post}
        boards={boards}
        tags={tags}
        statuses={statuses}
        open={isEditDialogOpen}
        onOpenChange={setEditDialogOpen}
      />
    </>
  )
}
