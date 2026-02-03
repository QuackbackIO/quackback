'use client'

import { Suspense, useState, useEffect, useCallback, startTransition } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon, LinkIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { adminQueries } from '@/lib/client/queries/admin'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { VoteButton } from '@/components/public/vote-button'
import { PostContentSection } from '@/components/public/post-detail/post-content-section'
import {
  MetadataSidebar,
  MetadataSidebarSkeleton,
} from '@/components/public/post-detail/metadata-sidebar'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import { PinnedCommentSection } from '@/components/public/post-detail/official-response-section'
import {
  useUpdatePostStatus,
  useUpdatePostTags,
  usePinComment,
  useUnpinComment,
} from '@/lib/client/mutations'
import { addPostToRoadmapFn, removePostFromRoadmapFn } from '@/lib/server/functions/roadmaps'
import { Route } from '@/routes/admin/roadmap'
import {
  ensureTypeId,
  type PostId,
  type StatusId,
  type TagId,
  type RoadmapId,
  type CommentId,
} from '@quackback/ids'
import type { PostDetails, CurrentUser } from '@/components/admin/feedback/inbox-types'
import type { PublicPostDetailView } from '@/lib/client/queries/portal-detail'

interface RoadmapModalProps {
  postId: string | undefined
  currentUser: CurrentUser
}

interface RoadmapModalContentProps {
  postId: PostId
  currentUser: CurrentUser
  onClose: () => void
}

/** Convert admin PostDetails to portal-compatible view */
function toPortalPostView(post: PostDetails): PublicPostDetailView {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    contentJson: post.contentJson ?? { type: 'doc' },
    statusId: post.statusId,
    voteCount: post.voteCount,
    authorName: post.authorName,
    memberId: post.memberId as `member_${string}` | null,
    authorAvatarUrl: (post.memberId && post.avatarUrls?.[post.memberId]) || null,
    createdAt: post.createdAt,
    board: post.board,
    tags: post.tags,
    roadmaps: [],
    comments: post.comments.map((c) => ({
      id: c.id as CommentId,
      content: c.content,
      authorName: c.authorName,
      memberId: c.memberId,
      createdAt: c.createdAt,
      parentId: c.parentId as CommentId | null,
      isTeamMember: c.isTeamMember,
      avatarUrl: (c.memberId && post.avatarUrls?.[c.memberId]) || null,
      reactions: c.reactions,
      replies: c.replies.map((r) => ({
        id: r.id as CommentId,
        content: r.content,
        authorName: r.authorName,
        memberId: r.memberId,
        createdAt: r.createdAt,
        parentId: r.parentId as CommentId | null,
        isTeamMember: r.isTeamMember,
        avatarUrl: (r.memberId && post.avatarUrls?.[r.memberId]) || null,
        reactions: r.reactions,
        replies: [],
      })),
    })),
    officialResponse: post.officialResponse,
    pinnedComment: post.pinnedComment,
    pinnedCommentId: post.pinnedCommentId,
  }
}

function RoadmapModalContent({ postId, currentUser, onClose }: RoadmapModalContentProps) {
  const queryClient = useQueryClient()

  // Queries
  const postQuery = useSuspenseQuery(adminQueries.postDetail(postId))
  const { data: tags = [] } = useQuery(adminQueries.tags())
  const { data: statuses = [] } = useQuery(adminQueries.statuses())
  const { data: roadmaps = [] } = useQuery(adminQueries.roadmaps())

  const post = postQuery.data as PostDetails

  // UI state
  const [isUpdating, setIsUpdating] = useState(false)
  const [pendingRoadmapId, setPendingRoadmapId] = useState<string | null>(null)

  // Mutations
  const updateStatus = useUpdatePostStatus()
  const updateTags = useUpdatePostTags()
  const pinComment = usePinComment({ postId: post.id as PostId })
  const unpinComment = useUnpinComment({ postId: post.id as PostId })

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

  const handleRoadmapAdd = async (roadmapId: RoadmapId) => {
    setPendingRoadmapId(roadmapId)
    try {
      await addPostToRoadmapFn({ data: { roadmapId, postId: post.id } })
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(post.id as PostId) })
    } finally {
      setPendingRoadmapId(null)
    }
  }

  const handleRoadmapRemove = async (roadmapId: RoadmapId) => {
    setPendingRoadmapId(roadmapId)
    try {
      await removePostFromRoadmapFn({ data: { roadmapId, postId: post.id } })
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(post.id as PostId) })
    } finally {
      setPendingRoadmapId(null)
    }
  }

  async function handleCopyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  // Convert post to portal-compatible view
  const portalPost = toPortalPostView(post)
  const postRoadmaps = (post.roadmapIds || [])
    .map((id) => roadmaps.find((r) => r.id === id))
    .filter(Boolean) as Array<{ id: string; name: string; slug: string }>

  portalPost.roadmaps = postRoadmaps

  const currentStatus = statuses.find((s) => s.id === post.statusId)

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-gradient-to-b from-card/98 to-card/95 backdrop-blur-md border-b border-border/40 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
            >
              <XMarkIcon className="h-4 w-4" />
            </Button>

            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-muted-foreground/60">Roadmap</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-foreground/80 font-medium truncate max-w-[240px]">
                {post.title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(`/b/${post.board.slug}/posts/${post.id}`, '_blank')}
              className="gap-1.5 h-8"
            >
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">View</span>
            </Button>

            <Button variant="ghost" size="sm" onClick={handleCopyLink} className="gap-1.5 h-8">
              <LinkIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Copy Link</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Post content layout */}
        <div className="flex">
          {/* Vote sidebar */}
          <div className="flex flex-col items-center justify-start py-6 px-4 border-r !border-r-[rgba(0,0,0,0.05)] dark:!border-r-[rgba(255,255,255,0.06)] bg-muted/10">
            <VoteButton postId={postId} voteCount={post.voteCount} />
          </div>

          {/* Main content */}
          <PostContentSection
            post={portalPost}
            currentStatus={currentStatus}
            authorAvatarUrl={(post.memberId && post.avatarUrls?.[post.memberId]) || null}
          />

          {/* Metadata sidebar */}
          <Suspense fallback={<MetadataSidebarSkeleton />}>
            <MetadataSidebar
              postId={postId}
              voteCount={post.voteCount}
              status={currentStatus}
              board={post.board}
              authorName={post.authorName}
              authorAvatarUrl={(post.memberId && post.avatarUrls?.[post.memberId]) || null}
              createdAt={new Date(post.createdAt)}
              tags={post.tags}
              roadmaps={postRoadmaps}
              canEdit
              allStatuses={statuses}
              allTags={tags}
              allRoadmaps={roadmaps}
              onStatusChange={handleStatusChange}
              onTagsChange={handleTagsChange}
              onRoadmapAdd={handleRoadmapAdd}
              onRoadmapRemove={handleRoadmapRemove}
              isUpdating={isUpdating || !!pendingRoadmapId}
              hideSubscribe
              hideVote
            />
          </Suspense>
        </div>

        {/* Pinned comment section */}
        {post.pinnedComment && (
          <PinnedCommentSection comment={post.pinnedComment} workspaceName="Team" />
        )}

        {/* Comments section */}
        <div className="bg-muted/20">
          <Suspense fallback={<CommentsSectionSkeleton />}>
            <CommentsSection
              postId={postId}
              comments={portalPost.comments}
              pinnedCommentId={post.pinnedCommentId}
              canPinComments
              onPinComment={(commentId) => pinComment.mutate(commentId)}
              onUnpinComment={() => unpinComment.mutate()}
              isPinPending={pinComment.isPending || unpinComment.isPending}
              adminUser={{ name: currentUser.name, email: currentUser.email }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export function RoadmapModal({ postId: urlPostId, currentUser }: RoadmapModalProps) {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()

  // Local state for instant UI - syncs with URL
  const [localPostId, setLocalPostId] = useState<string | undefined>(urlPostId)
  const isOpen = !!localPostId

  // Sync local state when URL changes (e.g., browser back/forward)
  useEffect(() => {
    setLocalPostId(urlPostId)
  }, [urlPostId])

  // Validate and convert postId
  let validatedPostId: PostId | null = null
  if (localPostId) {
    try {
      validatedPostId = ensureTypeId(localPostId, 'post')
    } catch {
      // Invalid post ID format
    }
  }

  // Close modal instantly, then update URL in background
  const close = useCallback(() => {
    setLocalPostId(undefined) // Instant UI update
    startTransition(() => {
      const { post: _, ...restSearch } = search
      navigate({
        to: '/admin/roadmap',
        search: restSearch,
        replace: true,
      })
    })
  }, [navigate, search])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">View post</DialogTitle>
        {validatedPostId && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <RoadmapModalContent
              postId={validatedPostId}
              currentUser={currentUser}
              onClose={close}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  )
}
