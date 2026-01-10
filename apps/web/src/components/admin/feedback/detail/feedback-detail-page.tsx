import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
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
import type { Board, Tag, PostStatusEntity, Roadmap } from '@/lib/db-types'
import type { CommentId, PostId, StatusId, TagId } from '@quackback/ids'
import { useNavigationContext } from './use-navigation-context'

interface FeedbackDetailPageProps {
  post: PostDetails
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  roadmaps: Roadmap[]
  currentUser: CurrentUser
}

export function FeedbackDetailPage({
  post,
  boards,
  tags,
  statuses,
  roadmaps,
  currentUser,
}: FeedbackDetailPageProps): React.ReactElement {
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
          roadmaps={roadmaps}
          avatarUrls={post.avatarUrls}
          onStatusChange={handleStatusChange}
          onTagsChange={handleTagsChange}
          onRoadmapChange={handleRoadmapChange}
          isUpdating={isUpdating}
        />

        {/* Main content area */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <DetailHeader
            post={post}
            navigationContext={navigationContext}
            onEdit={() => setEditDialogOpen(true)}
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
