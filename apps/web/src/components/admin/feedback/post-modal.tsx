'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { CustomerContextPanel } from '@/components/admin/feedback/customer-context-panel'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ModalHeader } from '@/components/shared/modal-header'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { usePostImageUpload } from '@/lib/client/hooks/use-image-upload'
import { adminQueries } from '@/lib/client/queries/admin'
import { postOwnerQueries } from '@/lib/client/queries/post-owner'
import { mergeSuggestionQueries } from '@/lib/client/queries/signals'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import {
  MetadataSidebar,
  MetadataSidebarSkeleton,
  ManagePostActions,
} from '@/components/public/post-detail/metadata-sidebar'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import {
  MergeActions,
  MergeInfoBanner,
  MergeOthersDialog,
} from '@/components/admin/feedback/merge-section'
import { AiSummaryCard } from '@/components/admin/feedback/ai-summary-card'
import { SimilarPostsCard } from '@/components/admin/feedback/similar-posts-card'
import { PostActivityTimeline } from '@/components/admin/feedback/detail/post-activity-timeline'
import { useNavigationContext } from '@/components/admin/feedback/detail/use-navigation-context'
import {
  useUpdatePost,
  useChangePostStatusId,
  useUpdatePostTags,
  usePinComment,
  useUnpinComment,
  useToggleCommentsLock,
  useDeletePost,
  useRestorePost,
  useChangePostBoard,
  useUpdatePostOwner,
} from '@/lib/client/mutations'
import {
  DeletePostDialog,
  type CascadeChoice,
} from '@/components/public/post-detail/delete-post-dialog'
import { usePostExternalLinks } from '@/lib/client/hooks/use-post-external-links-query'
import { usePostDetailKeyboard } from '@/lib/client/hooks/use-post-detail-keyboard'
import { setPostEtaFn } from '@/lib/server/functions/posts'
import { useRouterState } from '@tanstack/react-router'
import {
  type PostId,
  type PostStatusId,
  type PostTagId,
  type PostCommentId,
  type BoardId,
  type PrincipalId,
} from '@quackback/ids'
import { useDeleteComment, useRestoreComment } from '@/lib/client/mutations/portal-comments'
import { useLoadMoreAdminComments } from '@/lib/client/mutations/load-more-comments'
import type { PostDetails, CurrentUser } from '@/lib/shared/types'
import {
  toPortalComments,
  getInitialContentJson,
} from '@/components/admin/feedback/detail/post-utils'

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
  const { data: boards = [] } = useQuery(adminQueries.boards())

  // Owner (assignee) control — gated on post.set_owner. The roster is fetched
  // via the same post.set_owner-gated fn the portal uses; the current owner is
  // resolved from it against the post's ownerPrincipalId (already in payload).
  const canSetOwner = usePermission(PERMISSIONS.POST_SET_OWNER)
  const { data: ownerCandidates } = useQuery({
    ...postOwnerQueries.candidates(),
    enabled: canSetOwner,
  })

  const post = postQuery.data as PostDetails

  // "Show more comments" — appends the next keyset page into the same
  // ['inbox','detail',postId] cache the admin comment mutations patch.
  const {
    loadMore: loadMoreComments,
    isLoading: isLoadingMoreComments,
    hasMore: hasMoreComments,
  } = useLoadMoreAdminComments(postId, inboxKeys.detail(postId))

  // Image upload
  const { upload: uploadImage } = usePostImageUpload()

  // Form state - always in edit mode
  const [title, setTitle] = useState(post.title)
  const [contentJson, setContentJson] = useState<JSONContent | null>(getInitialContentJson(post))
  const [contentMarkdown, setContentMarkdown] = useState(post.content ?? '')
  const [hasInitialized, setHasInitialized] = useState(false)

  // UI state
  const [isUpdating, setIsUpdating] = useState(false)
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [showMergeOthersDialog, setShowMergeOthersDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [activeTab, setActiveTab] = useState<'comments' | 'activity'>('comments')

  // Duplicate badge indicator — derived from merge suggestions (deduped by React Query with SimilarPostsCard)
  const { data: mergeSuggestionsData } = useQuery(mergeSuggestionQueries.forPost(postId))
  const hasDuplicateSignals = (mergeSuggestionsData?.length ?? 0) > 0

  // Navigation context
  const navigationContext = useNavigationContext(post.id)

  // Mutations
  const updatePost = useUpdatePost()
  const updateStatus = useChangePostStatusId()
  const updateTags = useUpdatePostTags()
  const pinComment = usePinComment({ postId: post.id as PostId })
  const unpinComment = useUnpinComment({ postId: post.id as PostId })
  const deleteCommentMutation = useDeleteComment({
    postId: post.id as PostId,
    onError: (error) => toast.error(error.message || 'Failed to delete comment'),
  })
  const restoreCommentMutation = useRestoreComment({
    postId: post.id as PostId,
    onError: (error) => toast.error(error.message || 'Failed to restore comment'),
  })
  const toggleCommentsLock = useToggleCommentsLock()
  const deletePost = useDeletePost()
  const restorePostMutation = useRestorePost()
  const changePostBoard = useChangePostBoard()
  const updateOwner = useUpdatePostOwner()

  // External links for cascade delete
  const externalLinksQuery = usePostExternalLinks(post.id as PostId, showDeleteDialog)

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
    setShowMergeOthersDialog(false)
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
  const handleStatusChange = async (statusId: PostStatusId) => {
    setIsUpdating(true)
    try {
      await updateStatus.mutateAsync({ postId: post.id as PostId, statusId })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleTagsChange = async (tagIds: PostTagId[]) => {
    setIsUpdating(true)
    try {
      await updateTags.mutateAsync({ postId: post.id as PostId, tagIds, allTags: tags })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleBoardChange = async (boardId: BoardId) => {
    setIsUpdating(true)
    try {
      await changePostBoard.mutateAsync({ postId: post.id as PostId, boardId })
      toast.success('Board updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update board')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleOwnerChange = async (ownerId: PrincipalId | null) => {
    try {
      // The mutation applies the change optimistically and invalidates the
      // inbox detail/list caches, matching the other sidebar callbacks here.
      await updateOwner.mutateAsync({ postId: post.id as PostId, ownerId })
      toast.success(ownerId ? 'Owner assigned' : 'Owner unassigned')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update owner')
    }
  }

  const handleEtaChange = async (eta: string | null) => {
    setIsUpdating(true)
    try {
      await setPostEtaFn({ data: { id: post.id, eta } })
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(post.id as PostId) })
      toast.success(eta ? 'ETA updated' : 'ETA cleared')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update ETA')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleContentChange = useCallback((_json: JSONContent, _html: string, markdown: string) => {
    setContentJson(_json)
    setContentMarkdown(markdown)
  }, [])

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

    try {
      await updatePost.mutateAsync({
        postId: post.id as PostId,
        title: title.trim(),
        content: contentMarkdown,
        contentJson: contentJson ?? null,
      })
      toast.success('Post updated')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update post')
    }
  }

  // Check if there are changes
  const hasChanges = title !== post.title || contentMarkdown !== (post.content ?? '')

  const handleKeyDown = useKeyboardSubmit(hasChanges ? handleSubmit : () => {})

  const currentStatus = statuses.find((s) => s.id === post.statusId)
  const currentOwner =
    (post.ownerPrincipalId &&
      (ownerCandidates ?? []).find((m) => m.principalId === post.ownerPrincipalId)) ||
    null
  const manageActions = {
    onMergeOthers: () => setShowMergeOthersDialog(true),
    onMergeInto: () => setShowMergeDialog(true),
    onToggleLock: () =>
      toggleCommentsLock.mutate({
        postId: post.id as PostId,
        locked: !post.isCommentsLocked,
      }),
    isCommentsLocked: !!post.isCommentsLocked,
    isLockPending: toggleCommentsLock.isPending,
    onDelete: () => setShowDeleteDialog(true),
    onRestore: async () => {
      try {
        await restorePostMutation.mutateAsync(post.id as PostId)
        toast.success('Post restored')
        onClose()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to restore post')
      }
    },
    isDeleted: !!post.deletedAt,
    isRestorePending: restorePostMutation.isPending,
    isMerged: !!post.mergeInfo,
    hasDuplicateSignals,
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <ModalHeader
        section="Feedback"
        title={post.title}
        onClose={onClose}
        viewUrl={`/b/${post.board.slug}/posts/${post.id}`}
      >
        <ManagePostActions actions={manageActions} showLabel={false} className="lg:hidden" />
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
      <ScrollArea className="flex-1 min-h-0">
        {/* Merge info banner (if this post has been merged into another) */}
        {post.mergeInfo && (
          <MergeInfoBanner mergeInfo={post.mergeInfo} onNavigateToPost={onNavigateToPost} />
        )}

        {/* 2-column layout - extends full height */}
        <div className="flex">
          {/* Left: Content, AI, Comments */}
          <div className="flex-1 min-w-0">
            {/* Editor area */}
            <div className="p-6" onKeyDown={handleKeyDown}>
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
                placeholder="Add more details... Type / for commands"
                minHeight="200px"
                disabled={updatePost.isPending}
                borderless
                toolbarPosition="bottom"
                features={{
                  headings: true,
                  codeBlocks: true,
                  taskLists: true,
                  blockquotes: true,
                  dividers: true,
                  images: true,
                  tables: true,
                  embeds: true,
                  quackbackEmbeds: true,
                  bubbleMenu: true,
                  slashMenu: true,
                }}
                onImageUpload={uploadImage}
              />

              {/* AI section — summary + similar posts */}
              <div className="mt-8 space-y-3">
                {post.summaryJson && (
                  <AiSummaryCard
                    summaryJson={post.summaryJson}
                    summaryUpdatedAt={post.summaryUpdatedAt ?? null}
                  />
                )}
                <SimilarPostsCard postId={postId} onNavigateToPost={onNavigateToPost} />
              </div>
            </div>

            {/* Merge actions section */}
            <MergeActions
              postId={postId}
              postTitle={post.title}
              canonicalPostId={post.canonicalPostId as PostId | undefined}
              showDialog={showMergeDialog}
              onShowDialogChange={setShowMergeDialog}
            />

            {/* Merge others dialog */}
            <MergeOthersDialog
              postId={postId}
              postTitle={post.title}
              open={showMergeOthersDialog}
              onOpenChange={setShowMergeOthersDialog}
            />

            {/* Comments / Activity tabs */}
            <div>
              <div className="flex gap-4 px-6 mb-3">
                {(['comments', 'activity'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`pb-2 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? 'border-b-2 border-foreground text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab === 'comments' ? 'Comments' : 'Activity'}
                  </button>
                ))}
              </div>

              {activeTab === 'comments' ? (
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
                    onDeleteComment={(commentId: PostCommentId) =>
                      deleteCommentMutation.mutate(commentId)
                    }
                    deletingCommentId={
                      deleteCommentMutation.isPending
                        ? (deleteCommentMutation.variables as PostCommentId)
                        : null
                    }
                    onRestoreComment={(commentId: PostCommentId) =>
                      restoreCommentMutation.mutate(commentId)
                    }
                    restoringCommentId={
                      restoreCommentMutation.isPending
                        ? (restoreCommentMutation.variables as PostCommentId)
                        : null
                    }
                    hasMoreComments={hasMoreComments}
                    onLoadMoreComments={loadMoreComments}
                    isLoadingMoreComments={isLoadingMoreComments}
                    remainingCommentCount={
                      post.commentsTotalRootCount != null
                        ? Math.max(0, post.commentsTotalRootCount - post.comments.length)
                        : undefined
                    }
                  />
                </Suspense>
              ) : (
                <PostActivityTimeline postId={postId} />
              )}
            </div>
          </div>

          {/* Right: Metadata sidebar */}
          <Suspense fallback={<MetadataSidebarSkeleton variant="card" />}>
            <MetadataSidebar
              postId={postId}
              voteCount={post.voteCount}
              status={currentStatus}
              board={post.board}
              authorName={post.authorName}
              authorAvatarUrl={(post.principalId && post.avatarUrls?.[post.principalId]) || null}
              authorPrincipalId={post.principalId}
              createdAt={new Date(post.createdAt)}
              eta={post.eta ?? null}
              tags={post.tags}
              canEdit
              showVoters
              allStatuses={statuses}
              allTags={tags}
              allBoards={boards}
              onStatusChange={handleStatusChange}
              onEtaChange={handleEtaChange}
              onTagsChange={handleTagsChange}
              onBoardChange={handleBoardChange}
              owner={currentOwner}
              ownerCandidates={canSetOwner ? ownerCandidates : undefined}
              onOwnerChange={canSetOwner ? handleOwnerChange : undefined}
              isUpdating={isUpdating}
              hideSubscribe
              variant="card"
              manageActions={manageActions}
            />
          </Suspense>

          {/* Customer context from connected CRM integrations (WO-9), on demand. */}
          <CustomerContextPanel email={post.authorEmail} />
        </div>
      </ScrollArea>

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
        externalLinks={externalLinksQuery.data}
        isLoadingLinks={externalLinksQuery.isLoading}
        isErrorLinks={externalLinksQuery.isError}
        description={
          <>
            This will delete &ldquo;{post.title}&rdquo; from the portal. You can restore it within
            30 days, after which it will be permanently deleted.
          </>
        }
        onConfirm={async (cascadeChoices: CascadeChoice[]) => {
          try {
            const result = await deletePost.mutateAsync({
              postId: post.id as PostId,
              cascadeChoices,
            })
            toast.success('Post deleted')
            // Show warnings for failed cascade operations
            if (result.cascadeResults) {
              for (const r of result.cascadeResults) {
                if (!r.success) {
                  toast.warning(`Failed to close ${r.integrationType} issue: ${r.error}`)
                }
              }
            }
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
