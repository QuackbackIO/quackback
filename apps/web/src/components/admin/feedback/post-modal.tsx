'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
  LockClosedIcon,
  LockOpenIcon,
  TrashIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { ModalHeader } from '@/components/shared/modal-header'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { Button } from '@/components/ui/button'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import { adminQueries } from '@/lib/client/queries/admin'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import {
  MetadataSidebar,
  MetadataSidebarSkeleton,
} from '@/components/public/post-detail/metadata-sidebar'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import { MergeActions, MergeInfoBanner } from '@/components/admin/feedback/merge-section'
import { MergeSuggestionBanner } from '@/components/admin/feedback/merge-suggestion-banner'
import { AiSummaryCard } from '@/components/admin/feedback/ai-summary-card'
import { useNavigationContext } from '@/components/admin/feedback/detail/use-navigation-context'
import {
  useUpdatePost,
  useUpdatePostStatus,
  useUpdatePostTags,
  usePinComment,
  useUnpinComment,
  useToggleCommentsLock,
  useDeletePost,
  useRestorePost,
} from '@/lib/client/mutations'
import { DeletePostDialog } from '@/components/public/post-detail/delete-post-dialog'
import { usePostDetailKeyboard } from '@/lib/client/hooks/use-post-detail-keyboard'
import { addPostToRoadmapFn, removePostFromRoadmapFn } from '@/lib/server/functions/roadmaps'
import { useRouterState } from '@tanstack/react-router'
import {
  type PostId,
  type StatusId,
  type TagId,
  type RoadmapId,
  type CommentId,
} from '@quackback/ids'
import type { PostDetails, CurrentUser } from '@/components/admin/feedback/inbox-types'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'

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

/** Convert admin comments to portal-compatible format */
function toPortalComments(post: PostDetails): PublicCommentView[] {
  const mapComment = (c: PostDetails['comments'][0]): PublicCommentView => ({
    id: c.id as CommentId,
    content: c.content,
    authorName: c.authorName,
    principalId: c.principalId,
    createdAt: c.createdAt,
    parentId: c.parentId as CommentId | null,
    isTeamMember: c.isTeamMember,
    avatarUrl: (c.principalId && post.avatarUrls?.[c.principalId]) || null,
    statusChange: c.statusChange ?? null,
    reactions: c.reactions,
    replies: c.replies.map(mapComment),
  })
  return post.comments.map(mapComment)
}

/** Convert plain text to TipTap JSON format for posts without contentJson */
function getInitialContentJson(post: {
  contentJson?: unknown
  content: string
}): JSONContent | null {
  if (post.contentJson) {
    return post.contentJson as JSONContent
  }
  if (post.content) {
    return {
      type: 'doc',
      content: post.content.split('\n').map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      })),
    }
  }
  return null
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
  const { data: tags = [] } = useQuery(adminQueries.tags())
  const { data: statuses = [] } = useQuery(adminQueries.statuses())
  const { data: roadmaps = [] } = useQuery(adminQueries.roadmaps())

  const post = postQuery.data as PostDetails

  // Form state - always in edit mode
  const [title, setTitle] = useState(post.title)
  const [contentJson, setContentJson] = useState<JSONContent | null>(getInitialContentJson(post))
  const [hasInitialized, setHasInitialized] = useState(false)

  // UI state
  const [isUpdating, setIsUpdating] = useState(false)
  const [pendingRoadmapId, setPendingRoadmapId] = useState<string | null>(null)
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // Navigation context
  const navigationContext = useNavigationContext(post.id)

  // Mutations
  const updatePost = useUpdatePost()
  const updateStatus = useUpdatePostStatus()
  const updateTags = useUpdatePostTags()
  const pinComment = usePinComment({ postId: post.id as PostId })
  const unpinComment = useUnpinComment({ postId: post.id as PostId })
  const toggleCommentsLock = useToggleCommentsLock()
  const deletePost = useDeletePost()
  const restorePostMutation = useRestorePost()

  // Initialize form with post data
  useEffect(() => {
    if (post && !hasInitialized) {
      setTitle(post.title)
      setContentJson(getInitialContentJson(post))
      setHasInitialized(true)
    }
  }, [post, hasInitialized])

  // Reset when navigating to different post
  useEffect(() => {
    setTitle(post.title)
    setContentJson(getInitialContentJson(post))
    setShowMergeDialog(false)
  }, [post.id, post.title, post.contentJson])

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

  const handleContentChange = useCallback((json: JSONContent) => {
    setContentJson(json)
  }, [])

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

    try {
      const plainText = contentJson ? richTextToPlainText(contentJson) : ''
      await updatePost.mutateAsync({
        postId: post.id as PostId,
        title: title.trim(),
        content: plainText,
        contentJson: contentJson ?? null,
      })
      toast.success('Post updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update post')
    }
  }

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  const currentStatus = statuses.find((s) => s.id === post.statusId)
  const postRoadmaps = (post.roadmapIds || [])
    .map((id) => roadmaps.find((r) => r.id === id))
    .filter(Boolean) as Array<{ id: string; name: string; slug: string }>

  // Check if there are changes
  const originalPlainText = post.contentJson
    ? richTextToPlainText(post.contentJson as JSONContent)
    : post.content
  const currentPlainText = contentJson ? richTextToPlainText(contentJson) : ''
  const hasChanges = title !== post.title || currentPlainText !== originalPlainText

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Header */}
      <ModalHeader
        section="Feedback"
        title={post.title}
        onClose={onClose}
        viewUrl={`/b/${post.board.slug}/posts/${post.id}`}
      >
        {!post.canonicalPostId && !post.mergeInfo && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowMergeDialog(true)}
            className="gap-1.5 h-8 text-muted-foreground hover:text-foreground"
          >
            <DocumentDuplicateIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Mark as duplicate</span>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            toggleCommentsLock.mutate({
              postId: post.id as PostId,
              locked: !post.isCommentsLocked,
            })
          }
          disabled={toggleCommentsLock.isPending}
          className="gap-1.5 h-8 text-muted-foreground hover:text-foreground"
        >
          {post.isCommentsLocked ? (
            <>
              <LockClosedIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Unlock comments</span>
            </>
          ) : (
            <>
              <LockOpenIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Lock comments</span>
            </>
          )}
        </Button>
        {post.deletedAt ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await restorePostMutation.mutateAsync(post.id as PostId)
                toast.success('Post restored')
                onClose()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to restore post')
              }
            }}
            disabled={restorePostMutation.isPending}
            className="gap-1.5 h-8 text-muted-foreground hover:text-foreground"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {restorePostMutation.isPending ? 'Restoring...' : 'Restore'}
            </span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            className="gap-1.5 h-8 text-muted-foreground hover:text-destructive"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        )}
        {navigationContext.total > 0 && (
          <div className="hidden sm:flex items-center gap-0.5 mr-2 px-2 py-1 rounded-lg bg-muted/30">
            <span className="text-xs tabular-nums text-muted-foreground font-medium px-1">
              {navigationContext.position} / {navigationContext.total}
            </span>
            <div className="flex items-center ml-1 border-l border-border/40 pl-1">
              <Button
                type="button"
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
                type="button"
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
      </ModalHeader>

      {/* Main content area - scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Merge info banner (if this post has been merged into another) */}
        {post.mergeInfo && (
          <MergeInfoBanner mergeInfo={post.mergeInfo} onNavigateToPost={onNavigateToPost} />
        )}

        {/* AI merge suggestion banner */}
        {!post.mergeInfo && <MergeSuggestionBanner postId={post.id as PostId} />}

        {/* 2-column layout for editor and metadata */}
        <div className="flex">
          {/* Left: Content editor */}
          <div className="flex-1 p-6">
            {/* Title input */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's the feedback about?"
              maxLength={200}
              autoFocus
              disabled={updatePost.isPending}
              className="w-full bg-transparent border-0 outline-none text-2xl font-semibold text-foreground placeholder:text-muted-foreground/60 placeholder:font-normal caret-primary mb-4"
            />

            {/* Rich text editor */}
            <RichTextEditor
              value={contentJson || ''}
              onChange={handleContentChange}
              placeholder="Add more details..."
              minHeight="200px"
              disabled={updatePost.isPending}
              borderless
              features={{
                headings: false,
                images: false,
                codeBlocks: false,
                bubbleMenu: true,
                slashMenu: false,
                taskLists: false,
                blockquotes: true,
                tables: false,
                dividers: false,
                embeds: false,
              }}
            />

            {/* AI Summary */}
            {post.summaryJson && (
              <AiSummaryCard
                summaryJson={post.summaryJson}
                summaryUpdatedAt={post.summaryUpdatedAt ?? null}
                summaryCommentCount={post.summaryCommentCount ?? null}
                currentCommentCount={post.commentCount ?? 0}
              />
            )}
          </div>

          {/* Right: Metadata sidebar */}
          <Suspense fallback={<MetadataSidebarSkeleton />}>
            <MetadataSidebar
              postId={postId}
              voteCount={post.voteCount}
              status={currentStatus}
              board={post.board}
              authorName={post.authorName}
              authorAvatarUrl={(post.principalId && post.avatarUrls?.[post.principalId]) || null}
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
            />
          </Suspense>
        </div>

        {/* Merge actions section */}
        <MergeActions
          postId={postId}
          postTitle={post.title}
          canonicalPostId={post.canonicalPostId as PostId | undefined}
          mergedPosts={post.mergedPosts}
          showDialog={showMergeDialog}
          onShowDialogChange={setShowMergeDialog}
        />

        {/* Comments section */}
        <div className="bg-muted/20 border-t border-border/30">
          <Suspense fallback={<CommentsSectionSkeleton />}>
            <CommentsSection
              postId={postId}
              comments={toPortalComments(post)}
              pinnedCommentId={post.pinnedCommentId}
              canPinComments
              onPinComment={(commentId) => pinComment.mutate(commentId)}
              onUnpinComment={() => unpinComment.mutate()}
              isPinPending={pinComment.isPending || unpinComment.isPending}
              adminUser={{ name: currentUser.name, email: currentUser.email }}
              statuses={statuses}
              currentStatusId={post.statusId}
              isTeamMember
            />
          </Suspense>
        </div>
      </div>

      {/* Footer */}
      <ModalFooter
        onCancel={onClose}
        submitLabel={updatePost.isPending ? 'Saving...' : 'Save Changes'}
        isPending={updatePost.isPending}
        submitType="button"
        onSubmit={handleSubmit}
        submitDisabled={!hasChanges}
      />

      {/* Delete confirmation dialog */}
      <DeletePostDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        postTitle={post.title}
        isPending={deletePost.isPending}
        description={
          <>
            This will delete &ldquo;{post.title}&rdquo; from the portal. You can restore it within
            30 days, after which it will be permanently deleted.
          </>
        }
        onConfirm={async () => {
          try {
            await deletePost.mutateAsync(post.id as PostId)
            toast.success('Post deleted')
            setShowDeleteDialog(false)
            onClose()
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete post')
          }
        }}
      />
    </div>
  )
}

export function PostModal({ postId: urlPostId, currentUser }: PostModalProps) {
  const { pathname, search } = useRouterState({ select: (s) => s.location })
  const { open, validatedId, close, navigateTo } = useUrlModal<PostId>({
    urlId: urlPostId,
    idPrefix: 'post',
    searchParam: 'post',
    route: pathname,
    search: search as Record<string, unknown>,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Edit post"
      hasValidId={!!validatedId}
    >
      {validatedId && (
        <PostModalContent
          postId={validatedId}
          currentUser={currentUser}
          onNavigateToPost={navigateTo}
          onClose={close}
        />
      )}
    </UrlModalShell>
  )
}
