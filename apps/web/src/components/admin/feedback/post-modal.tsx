import { Suspense, useState, useEffect, useCallback, startTransition } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  EllipsisHorizontalIcon,
  ArrowTopRightOnSquareIcon,
  LinkIcon,
  ExclamationTriangleIcon,
  ArrowPathRoundedSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { TrashIcon } from '@heroicons/react/24/outline'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { adminQueries } from '@/lib/queries/admin'
import { inboxKeys } from '@/lib/hooks/use-inbox-queries'
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
import {
  OfficialResponseSection,
  PinnedCommentSection,
} from '@/components/public/post-detail/official-response-section'
import { EditPostDialog } from '@/components/admin/feedback/edit-post-dialog'
import { useNavigationContext } from '@/components/admin/feedback/detail/use-navigation-context'
import { useInboxUIStore } from '@/lib/stores/inbox-ui'
import { useUpdatePostStatus, useUpdatePostTags } from '@/lib/hooks/use-inbox-queries'
import { usePinComment, useUnpinComment } from '@/lib/hooks/use-comment-actions'
import { usePostDetailKeyboard } from '@/lib/hooks/use-post-detail-keyboard'
import { addPostToRoadmapFn, removePostFromRoadmapFn } from '@/lib/server-functions/roadmaps'
import { Route } from '@/routes/admin/feedback'
import {
  ensureTypeId,
  type PostId,
  type StatusId,
  type TagId,
  type RoadmapId,
  type CommentId,
} from '@quackback/ids'
import type { PostDetails, CurrentUser } from '@/components/admin/feedback/inbox-types'
import type { PublicPostDetailView } from '@/lib/queries/portal-detail'

interface PostModalProps {
  postId: string | undefined
  currentUser: CurrentUser
}

interface PostModalContentProps {
  postId: PostId
  currentUser: CurrentUser
  onNavigateToPost: (postId: string) => void
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

function PostModalContent({
  postId,
  currentUser,
  onNavigateToPost,
  onClose,
}: PostModalContentProps) {
  const queryClient = useQueryClient()

  // Queries
  const postQuery = useSuspenseQuery(adminQueries.postDetail(postId))
  const { data: boards = [] } = useQuery(adminQueries.boards())
  const { data: tags = [] } = useQuery(adminQueries.tags())
  const { data: statuses = [] } = useQuery(adminQueries.statuses())
  const { data: roadmaps = [] } = useQuery(adminQueries.roadmaps())

  const post = postQuery.data as PostDetails

  // UI state
  const { isEditDialogOpen, setEditDialogOpen } = useInboxUIStore()
  const [isUpdating, setIsUpdating] = useState(false)
  const [pendingRoadmapId, setPendingRoadmapId] = useState<string | null>(null)

  // Navigation context
  const navigationContext = useNavigationContext(post.id)

  // Mutations
  const updateStatus = useUpdatePostStatus()
  const updateTags = useUpdatePostTags()
  const pinComment = usePinComment({ postId: post.id as PostId })
  const unpinComment = useUnpinComment({ postId: post.id as PostId })

  // Keyboard navigation
  usePostDetailKeyboard({
    enabled: true,
    onNextPost: () => {
      if (navigationContext.nextId) {
        onNavigateToPost(navigationContext.nextId)
      }
    },
    onPrevPost: () => {
      if (navigationContext.prevId) {
        onNavigateToPost(navigationContext.prevId)
      }
    },
    onClose,
    onEdit: () => setEditDialogOpen(true),
  })

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

  const handlePinComment = (commentId: CommentId) => {
    pinComment.mutate(commentId)
  }

  const handleUnpinComment = () => {
    unpinComment.mutate()
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
    <>
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
                <span className="text-muted-foreground/60">Feedback</span>
                <span className="text-muted-foreground/40">/</span>
                <span className="text-foreground/80 font-medium truncate max-w-[240px]">
                  {post.title}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {navigationContext.total > 0 && (
                <div className="hidden sm:flex items-center gap-0.5 mr-2 px-2 py-1 rounded-lg bg-muted/30">
                  <span className="text-xs tabular-nums text-muted-foreground font-medium px-1">
                    {navigationContext.position} / {navigationContext.total}
                  </span>
                  <div className="flex items-center ml-1 border-l border-border/40 pl-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        navigationContext.prevId && onNavigateToPost(navigationContext.prevId)
                      }
                      disabled={!navigationContext.prevId}
                      className="h-6 w-6 hover:bg-muted/60 disabled:opacity-30 transition-all duration-150"
                    >
                      <ChevronLeftIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        navigationContext.nextId && onNavigateToPost(navigationContext.nextId)
                      }
                      disabled={!navigationContext.nextId}
                      className="h-6 w-6 hover:bg-muted/60 disabled:opacity-30 transition-all duration-150"
                    >
                      <ChevronRightIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditDialogOpen(true)}
                className="gap-1.5 h-8 border-border/50 hover:border-border hover:bg-muted/50 transition-all duration-150"
              >
                <PencilIcon className="h-3 w-3" />
                <span className="hidden sm:inline text-sm">Edit</span>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-muted/50 transition-all duration-150"
                  >
                    <EllipsisHorizontalIcon className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44" sideOffset={4}>
                  <DropdownMenuItem
                    onClick={() => window.open(`/b/${post.board.slug}/posts/${post.id}`, '_blank')}
                    className="gap-2"
                  >
                    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                    View in Portal
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyLink} className="gap-2">
                    <LinkIcon className="h-3.5 w-3.5" />
                    Copy Link
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" className="gap-2">
                    <TrashIcon className="h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {/* Deleted post alert */}
          {post.deletedAt && (
            <Alert variant="destructive" className="m-4 rounded-lg">
              <ExclamationTriangleIcon className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>
                  This post was deleted
                  {post.deletedByMemberName ? ` by ${post.deletedByMemberName}` : ''}
                  {' on '}
                  {new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  }).format(new Date(post.deletedAt))}
                  .
                </span>
                <div className="flex items-center gap-2 ml-4">
                  <Button variant="outline" size="sm" className="bg-background hover:bg-muted">
                    <ArrowPathRoundedSquareIcon className="h-3.5 w-3.5 mr-1.5" />
                    Restore
                  </Button>
                  <Button variant="destructive" size="sm">
                    <TrashIcon className="h-3.5 w-3.5 mr-1.5" />
                    Delete Permanently
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Post content layout */}
          <div className="flex border-b border-border/30">
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

          {/* Official response / Pinned comment */}
          {post.pinnedComment ? (
            <PinnedCommentSection comment={post.pinnedComment} workspaceName="Team" />
          ) : post.officialResponse ? (
            <OfficialResponseSection
              content={post.officialResponse.content}
              authorName={post.officialResponse.authorName}
              respondedAt={post.officialResponse.respondedAt}
              workspaceName="Team"
            />
          ) : null}

          {/* Comments */}
          <div className="bg-muted/20">
            <Suspense fallback={<CommentsSectionSkeleton />}>
              <CommentsSection
                postId={postId}
                comments={portalPost.comments}
                pinnedCommentId={post.pinnedCommentId}
                canPinComments
                onPinComment={handlePinComment}
                onUnpinComment={handleUnpinComment}
                isPinPending={pinComment.isPending || unpinComment.isPending}
                adminUser={currentUser}
              />
            </Suspense>
          </div>
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

export function PostModal({ postId: urlPostId, currentUser }: PostModalProps) {
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
        to: '/admin/feedback',
        search: restSearch,
        replace: true,
      })
    })
  }, [navigate, search])

  // Navigate to a different post - instant UI, background URL update
  const navigateToPost = useCallback(
    (newPostId: string) => {
      setLocalPostId(newPostId) // Instant UI update
      startTransition(() => {
        navigate({
          to: '/admin/feedback',
          search: { ...search, post: newPostId },
          replace: true,
        })
      })
    },
    [navigate, search]
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="w-[95vw] sm:w-[90vw] lg:max-w-6xl xl:max-w-7xl h-[90vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Post details</DialogTitle>
        {validatedPostId && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <PostModalContent
              postId={validatedPostId}
              currentUser={currentUser}
              onNavigateToPost={navigateToPost}
              onClose={close}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  )
}
