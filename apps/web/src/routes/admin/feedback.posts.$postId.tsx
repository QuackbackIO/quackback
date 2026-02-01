import { Suspense, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  EllipsisHorizontalIcon,
  ArrowTopRightOnSquareIcon,
  LinkIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathRoundedSquareIcon,
} from '@heroicons/react/24/solid'
import { TrashIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useNavigationContext } from '@/components/admin/feedback/detail/use-navigation-context'
import { useInboxUIStore } from '@/lib/stores/inbox-ui'
import { useUpdatePostStatus, useUpdatePostTags } from '@/lib/hooks/use-inbox-queries'
import { usePinComment, useUnpinComment } from '@/lib/hooks/use-comment-actions'
import { usePostDetailKeyboard } from '@/lib/hooks/use-post-detail-keyboard'
import { addPostToRoadmapFn, removePostFromRoadmapFn } from '@/lib/server-functions/roadmaps'
import {
  ensureTypeId,
  type PostId,
  type StatusId,
  type TagId,
  type RoadmapId,
  type CommentId,
} from '@quackback/ids'
import type { PostDetails } from '@/components/admin/feedback/inbox-types'
import type { PublicPostDetailView } from '@/lib/queries/portal-detail'

export const Route = createFileRoute('/admin/feedback/posts/$postId')({
  errorComponent: DetailErrorComponent,
  loader: async ({ params, context }) => {
    const { postId } = params
    const {
      user: currentUser,
      member,
      queryClient,
    } = context as {
      user: NonNullable<typeof context.user>
      member: NonNullable<typeof context.member>
      queryClient: typeof context.queryClient
    }

    let validatedPostId: PostId
    try {
      validatedPostId = ensureTypeId(postId, 'post')
    } catch {
      throw new Error('Invalid post ID format')
    }

    await Promise.all([
      queryClient.ensureQueryData(adminQueries.postDetail(validatedPostId)),
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(adminQueries.tags()),
      queryClient.ensureQueryData(adminQueries.statuses()),
      queryClient.ensureQueryData(adminQueries.roadmaps()),
    ])

    return {
      postId: validatedPostId,
      currentUser: {
        name: currentUser.name,
        email: currentUser.email,
        memberId: member.id,
      },
    }
  },
  component: FeedbackDetailRoute,
})

function DetailErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <ExclamationCircleIcon className="h-4 w-4" />
        <AlertTitle>Failed to load feedback</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-4">{error.message}</p>
          <Button onClick={reset} variant="outline" size="sm">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
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
    roadmaps: [], // Will be populated from roadmaps query
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
        replies: [], // Flatten beyond 2 levels
      })),
    })),
    officialResponse: post.officialResponse,
    pinnedComment: post.pinnedComment,
    pinnedCommentId: post.pinnedCommentId,
  }
}

function FeedbackDetailRoute(): React.ReactElement {
  const { postId, currentUser } = Route.useLoaderData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Queries
  const postQuery = useSuspenseQuery(adminQueries.postDetail(postId))
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const statusesQuery = useSuspenseQuery(adminQueries.statuses())
  const roadmapsQuery = useSuspenseQuery(adminQueries.roadmaps())

  const post = postQuery.data as PostDetails
  const statuses = statusesQuery.data
  const tags = tagsQuery.data
  const roadmaps = roadmapsQuery.data

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
        navigate({
          to: '/admin/feedback/posts/$postId',
          params: { postId: navigationContext.nextId },
        })
      }
    },
    onPrevPost: () => {
      if (navigationContext.prevId) {
        navigate({
          to: '/admin/feedback/posts/$postId',
          params: { postId: navigationContext.prevId },
        })
      }
    },
    onClose: () => navigate({ to: navigationContext.backUrl }),
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
  // Map roadmapIds to full roadmap objects
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
                size="sm"
                onClick={() => navigate({ to: navigationContext.backUrl })}
                className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" />
                <span className="text-sm">Back</span>
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
                        navigationContext.prevId &&
                        navigate({
                          to: '/admin/feedback/posts/$postId',
                          params: { postId: navigationContext.prevId },
                        })
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
                        navigationContext.nextId &&
                        navigate({
                          to: '/admin/feedback/posts/$postId',
                          params: { postId: navigationContext.nextId },
                        })
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
        <div className="flex-1 overflow-y-auto p-6">
          {/* Deleted post alert */}
          {post.deletedAt && (
            <Alert variant="destructive" className="mb-6 rounded-lg">
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

          {/* Post card */}
          <div className="bg-card border border-border/40 rounded-lg overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
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
                  // Admin mode props
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
      </div>

      {/* Edit dialog */}
      <EditPostDialog
        post={post}
        boards={boardsQuery.data}
        tags={tagsQuery.data}
        statuses={statusesQuery.data}
        open={isEditDialogOpen}
        onOpenChange={setEditDialogOpen}
      />
    </>
  )
}
