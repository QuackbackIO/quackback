import { Suspense, useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { createFileRoute, notFound, useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { BackLink } from '@/components/ui/back-link'
import { portalDetailQueries, type PublicPostDetailView } from '@/lib/client/queries/portal-detail'
import { portalQueries } from '@/lib/client/queries/portal'
import { UnsubscribeBanner } from '@/components/public/unsubscribe-banner'
import { VoteSidebar, VoteSidebarSkeleton } from '@/components/public/post-detail/vote-sidebar'
import { PostContentSection } from '@/components/public/post-detail/post-content-section'
import {
  MetadataSidebar,
  MetadataSidebarSkeleton,
} from '@/components/public/post-detail/metadata-sidebar'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import { DeletePostDialog } from '@/components/public/post-detail/delete-post-dialog'
import { usePostPermissions, postPermissionsKeys } from '@/lib/client/hooks/use-portal-posts-query'
import { getPostPermissionsFn } from '@/lib/server/functions/public-posts'
import { usePostActions } from '@/lib/client/mutations'
import { usePortalTeamPostActions } from '@/lib/client/mutations/portal-team-post-actions'
import { MergeIntoDialog, MergeOthersDialog } from '@/components/admin/feedback/merge-section'
import { usePortalImageUpload } from '@/lib/client/hooks/use-image-upload'
import {
  useDeleteComment,
  usePinComment,
  useUnpinComment,
  useRestoreComment,
} from '@/lib/client/mutations/portal-comments'
import { useLoadMorePortalComments } from '@/lib/client/mutations/load-more-comments'
import { toast } from 'sonner'
import { PortalMergeBanner } from '@/components/public/post-detail/merge-banner'
import { similarPostsQuery } from '@/components/public/post-detail/similar-posts-section'
import { isValidTypeId, type PostCommentId, type PostId } from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import { isProductEnabled } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/_portal/b/$slug/posts/$postId')({
  loader: async ({ params, context }) => {
    const { slug, postId: postIdParam } = params
    const { settings, queryClient } = context

    if (!settings) {
      throw notFound()
    }
    if (!isProductEnabled(settings.featureFlags, 'feedback')) throw notFound()

    if (!isValidTypeId(postIdParam, 'post')) {
      throw notFound()
    }
    const postId = postIdParam as PostId

    // Fire non-critical prefetches (don't await - components handle their own loading via Suspense)
    queryClient.prefetchQuery(portalDetailQueries.voteSidebarData(postId))

    // Await critical data needed for initial render.
    // votedPosts must be awaited so usePostVote (non-Suspense) has data during SSR.
    // commentsSectionData and post permissions are warmed here (not fire-and-forget)
    // so the comments section and edit/delete controls render their real values on
    // first paint instead of flashing the undefined defaults (canComment/canEdit/canDelete).
    const [post] = await Promise.all([
      queryClient.ensureQueryData(portalDetailQueries.postDetail(postId)),
      queryClient.ensureQueryData(portalQueries.statuses()),
      queryClient.ensureQueryData(portalDetailQueries.votedPosts()),
      queryClient.ensureQueryData(portalDetailQueries.commentsSectionData(postId)),
      queryClient.ensureQueryData({
        queryKey: postPermissionsKeys.detail(postId),
        queryFn: () => getPostPermissionsFn({ data: { postId } }),
        staleTime: 30_000,
      }),
    ]).catch((error: unknown) => {
      // fetchPublicPostDetail returns null for a post the viewer can't see
      // (missing, deleted, or board access denied) and the queryFn surfaces
      // that as an error. Render it as the not-found page rather than the
      // generic error boundary — a denied viewer must get the same page as
      // a nonexistent post.
      if (error instanceof Error && error.message === 'Post not found') {
        throw notFound()
      }
      throw error
    })

    if (!post || post.board.slug !== slug) {
      throw notFound()
    }

    // Prefetch similar posts now that we have the title (non-blocking)
    queryClient.prefetchQuery(similarPostsQuery(post.title))

    return {
      settings,
      postId,
      slug,
      postTitle: post.title,
      boardName: post.board.name,
      baseUrl: context.baseUrl ?? '',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { postTitle, boardName, slug, postId, baseUrl } = loaderData
    const title = `${postTitle} - ${boardName}`
    const description = `${postTitle}. Vote and comment on this ${boardName} post.`
    const canonicalUrl = baseUrl ? `${baseUrl}/b/${slug}/posts/${postId}` : ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(canonicalUrl ? [{ property: 'og:url', content: canonicalUrl }] : []),
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  component: PostDetailPage,
})

function PostDetailPage() {
  const { postId, slug } = Route.useLoaderData()
  const { session } = useRouteContext({ from: '__root__' })

  const intl = useIntl()
  const [isEditingPost, setIsEditingPost] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [mergeIntoDialogOpen, setMergeIntoDialogOpen] = useState(false)
  const [mergeOthersDialogOpen, setMergeOthersDialogOpen] = useState(false)

  // Post detail already includes board data (JOINed in query)
  const postQuery = useSuspenseQuery(portalDetailQueries.postDetail(postId))
  const statusesQuery = useSuspenseQuery(portalQueries.statuses())

  const permissionsQuery = usePostPermissions({ postId })
  const { canEdit, canDelete, editReason, deleteReason } = permissionsQuery.data ?? {
    canEdit: false,
    canDelete: false,
  }

  // Team-member capabilities (permission-gated; empty set for customers, so
  // every flag reads false and the portal UI is unchanged for them).
  const team = usePortalTeamPostActions({
    postId,
    post: postQuery.data,
    boardSlug: slug,
    onEditSaved: () => setIsEditingPost(false),
  })

  // Author-window rules (canEdit/canDelete) and team permissions compose:
  // authors keep the user-scoped save/delete path, team members without
  // author rights go through the permission-enforced admin path.
  const effectiveCanEdit = canEdit || team.canTeamEdit
  const effectiveCanDelete = canDelete || team.canTeamDelete

  const isAnonymousSession = session?.user?.principalType === 'anonymous'
  const canUploadImages = effectiveCanEdit && !isAnonymousSession && !!session?.user
  const { upload: uploadImage } = usePortalImageUpload()

  const {
    editPost,
    deletePost,
    isEditing: isSavingEdit,
    isDeleting,
  } = usePostActions({
    postId,
    boardSlug: slug,
    onEditSuccess: () => setIsEditingPost(false),
    onDeleteSuccess: () => setDeleteDialogOpen(false),
  })

  const deleteComment = useDeleteComment({
    postId,
    onError: (error) => toast.error(error.message || 'Failed to delete comment'),
  })

  const pinComment = usePinComment({
    postId,
    onError: (error) => toast.error(error.message || 'Failed to pin comment'),
  })

  const unpinComment = useUnpinComment({
    postId,
    onError: (error) => toast.error(error.message || 'Failed to unpin comment'),
  })

  const restoreComment = useRestoreComment({
    postId,
    onError: (error) => toast.error(error.message || 'Failed to restore comment'),
  })

  // "Show more comments" — appends the next keyset page of root comments into
  // the same ['portal','post',postId] detail cache the mutations patch.
  const {
    loadMore: loadMoreComments,
    isLoading: isLoadingMoreComments,
    hasMore: hasMoreComments,
  } = useLoadMorePortalComments(postId)

  const post = postQuery.data
  // Use board data from post (already JOINed in the query)
  const board = post?.board

  if (!post || !board) {
    return (
      <div>
        {intl.formatMessage({ id: 'portal.postDetail.notFound', defaultMessage: 'Post not found' })}
      </div>
    )
  }

  const currentStatus = statusesQuery.data.find((s) => s.id === post.statusId)

  const typedPost: PublicPostDetailView = {
    ...post,
    contentJson: (post.contentJson ?? { type: 'doc' }) as TiptapContent,
  }

  // Manage row (merge / lock / delete) — team members only, one action per
  // permission key. The portal detail endpoint never serves deleted posts, so
  // the restore branch is wired but unreachable here.
  const manageActions =
    team.canMerge || team.canTeamEdit || team.canTeamDelete
      ? {
          onMergeOthers: team.canMerge ? () => setMergeOthersDialogOpen(true) : undefined,
          onMergeInto: team.canMerge ? () => setMergeIntoDialogOpen(true) : undefined,
          onToggleLock: team.onToggleLock,
          isCommentsLocked: !!post.isCommentsLocked,
          isLockPending: team.isLockPending,
          onDelete: team.canTeamDelete ? () => setDeleteDialogOpen(true) : undefined,
          onRestore: team.restorePostAsTeam,
          isDeleted: false,
          isRestorePending: team.isTeamRestoring,
          isMerged: !!post.mergeInfo,
          hasDuplicateSignals: false,
        }
      : undefined

  // Scroll to a comment anchor (e.g. arriving from a comment notification) once the
  // comments have rendered. Runs once per hash value (tracked via ref) and is a no-op,
  // not a retry loop, if the target comment never appears (e.g. it was deleted).
  // Honors prefers-reduced-motion with an instant jump and no animated highlight.
  const scrolledToHashRef = useRef<string | null>(null)
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.startsWith('#comment-') || scrolledToHashRef.current === hash) {
      return
    }

    const timeoutId = setTimeout(() => {
      const element = document.querySelector(hash)
      if (!element) {
        return
      }
      scrolledToHashRef.current = hash

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      if (prefersReducedMotion) {
        element.scrollIntoView({ block: 'center' })
        return
      }

      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element.classList.add('bg-primary/5')
      setTimeout(() => element.classList.remove('bg-primary/5'), 2000)
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [post.comments])

  return (
    <div data-testid="post-detail" className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-6">
      <UnsubscribeBanner postId={post.id as PostId} />

      <BackLink to="/" search={{ board: slug }} className="mb-6">
        {board.name}
      </BackLink>

      {/* Merge banner for duplicate posts */}
      {post.mergeInfo && (
        <PortalMergeBanner
          canonicalPostTitle={post.mergeInfo.canonicalPostTitle}
          canonicalPostBoardSlug={post.mergeInfo.canonicalPostBoardSlug}
          canonicalPostId={post.mergeInfo.canonicalPostId}
        />
      )}

      {/* Post detail card */}
      <div className="bg-card border border-border/40 rounded-lg overflow-hidden">
        <div className="flex">
          <Suspense fallback={<VoteSidebarSkeleton />}>
            <VoteSidebar postId={postId} voteCount={post.voteCount} disabled={!!post.mergeInfo} />
          </Suspense>

          <PostContentSection
            post={typedPost}
            currentStatus={currentStatus}
            authorAvatarUrl={post.authorAvatarUrl}
            canEdit={effectiveCanEdit}
            canDelete={effectiveCanDelete}
            editReason={editReason}
            deleteReason={deleteReason}
            onDelete={() => setDeleteDialogOpen(true)}
            isEditing={isEditingPost}
            onEditStart={() => setIsEditingPost(true)}
            onEditSave={canEdit ? editPost : (team.saveEditAsTeam ?? editPost)}
            onEditCancel={() => setIsEditingPost(false)}
            onImageUpload={canUploadImages ? uploadImage : undefined}
            isSaving={isSavingEdit || team.isTeamSavingEdit}
          />

          <Suspense fallback={<MetadataSidebarSkeleton />}>
            <MetadataSidebar
              postId={postId}
              voteCount={post.voteCount}
              status={currentStatus}
              board={board}
              authorName={post.authorName}
              authorAvatarUrl={post.authorAvatarUrl}
              createdAt={new Date(post.createdAt)}
              eta={post.eta ?? null}
              tags={post.tags}
              allStatuses={
                team.canSetStatus ? (statusesQuery.data as unknown as PostStatusEntity[]) : []
              }
              onStatusChange={team.onStatusChange}
              onEtaChange={team.onEtaChange}
              allTags={team.allTags}
              onTagsChange={team.onTagsChange}
              allBoards={team.allBoards}
              onBoardChange={team.onBoardChange}
              owner={team.owner}
              ownerCandidates={team.ownerCandidates}
              onOwnerChange={team.onOwnerChange}
              isUpdating={team.isMetaUpdating}
              showVoters={team.canVoteOnBehalf}
              votersQuery={team.votersQuery}
              votersCanAddVoter={team.canSearchPeople}
              votersCanCreateUser={team.canCreatePeople}
              onVotersInvalidate={team.invalidateVoters}
              manageActions={manageActions}
            />
          </Suspense>
        </div>
      </div>

      {/* Comments card */}
      <div className="bg-card border border-border/40 rounded-lg overflow-hidden mt-4">
        <Suspense fallback={<CommentsSectionSkeleton count={post.commentsTotalRootCount} />}>
          <CommentsSection
            postId={postId}
            comments={post.comments}
            pinnedCommentId={post.pinnedCommentId}
            disableCommenting={!!post.mergeInfo || !!post.isCommentsLocked}
            lockedMessage={
              post.isCommentsLocked
                ? intl.formatMessage({
                    id: 'portal.postDetail.commentsLocked',
                    defaultMessage: 'Comments are locked on this post',
                  })
                : undefined
            }
            statuses={statusesQuery.data}
            currentStatusId={post.statusId}
            onPinComment={(commentId: PostCommentId) => pinComment.mutate(commentId)}
            onUnpinComment={() => unpinComment.mutate()}
            isPinPending={pinComment.isPending || unpinComment.isPending}
            onDeleteComment={(commentId: PostCommentId) => deleteComment.mutate(commentId)}
            deletingCommentId={
              deleteComment.isPending ? (deleteComment.variables as PostCommentId) : null
            }
            onRestoreComment={(commentId: PostCommentId) => restoreComment.mutate(commentId)}
            restoringCommentId={
              restoreComment.isPending ? (restoreComment.variables as PostCommentId) : null
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
      </div>

      <DeletePostDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        postTitle={post.title}
        onConfirm={() => {
          if (canDelete) {
            deletePost()
          } else {
            void team.deletePostAsTeam?.()
          }
        }}
        isPending={isDeleting || team.isTeamDeleting}
      />

      {/* Merge dialogs — team members holding post.merge only. Invalidate on
          close so a completed merge is reflected on the portal page. */}
      {team.canMerge && (
        <>
          <MergeIntoDialog
            postId={postId}
            postTitle={post.title}
            open={mergeIntoDialogOpen}
            onOpenChange={(open) => {
              setMergeIntoDialogOpen(open)
              if (!open) team.invalidatePortal()
            }}
          />
          <MergeOthersDialog
            postId={postId}
            postTitle={post.title}
            open={mergeOthersDialogOpen}
            onOpenChange={(open) => {
              setMergeOthersDialogOpen(open)
              if (!open) team.invalidatePortal()
            }}
          />
        </>
      )}
    </div>
  )
}
