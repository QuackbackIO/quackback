import { Suspense, useEffect, useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
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
import { PortalMergeBanner } from '@/components/public/post-detail/merge-banner'
import { similarPostsQuery } from '@/components/public/post-detail/similar-posts-section'
import { isValidTypeId, type PostId } from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/schemas/posts'

export const Route = createFileRoute('/_portal/b/$slug/posts/$postId')({
  loader: async ({ params, context }) => {
    const { slug, postId: postIdParam } = params
    const { settings, queryClient } = context

    if (!settings) {
      throw notFound()
    }

    if (!isValidTypeId(postIdParam, 'post')) {
      throw notFound()
    }
    const postId = postIdParam as PostId

    // Fire prefetches immediately (don't await - components handle their own loading)
    queryClient.prefetchQuery(portalDetailQueries.voteSidebarData(postId))
    queryClient.prefetchQuery(portalDetailQueries.commentsSectionData(postId))
    queryClient.prefetchQuery(portalDetailQueries.votedPosts())
    queryClient.prefetchQuery({
      queryKey: postPermissionsKeys.detail(postId),
      queryFn: () => getPostPermissionsFn({ data: { postId } }),
      staleTime: 30_000,
    })

    // Await only critical data needed for initial render
    // Note: Post detail already includes board data (JOINed), so no separate board query needed
    const [post] = await Promise.all([
      queryClient.ensureQueryData(portalDetailQueries.postDetail(postId)),
      queryClient.ensureQueryData(portalQueries.statuses()),
    ])

    if (!post || post.board.slug !== slug) {
      throw notFound()
    }

    // Prefetch similar posts now that we have the title (non-blocking)
    queryClient.prefetchQuery(similarPostsQuery(post.title))

    return { settings, postId, slug }
  },
  component: PostDetailPage,
})

function PostDetailPage() {
  const { postId, slug } = Route.useLoaderData()

  const [isEditingPost, setIsEditingPost] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Post detail already includes board data (JOINed in query)
  const postQuery = useSuspenseQuery(portalDetailQueries.postDetail(postId))
  const statusesQuery = useSuspenseQuery(portalQueries.statuses())

  const permissionsQuery = usePostPermissions({ postId })
  const { canEdit, canDelete, editReason, deleteReason } = permissionsQuery.data ?? {
    canEdit: false,
    canDelete: false,
  }

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

  const post = postQuery.data
  // Use board data from post (already JOINed in the query)
  const board = post?.board

  if (!post || !board) {
    return <div>Post not found</div>
  }

  const currentStatus = statusesQuery.data.find((s) => s.id === post.statusId)

  const typedPost: PublicPostDetailView = {
    ...post,
    contentJson: (post.contentJson ?? { type: 'doc' }) as TiptapContent,
  }

  // Scroll to comment anchor after content loads
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.startsWith('#comment-')) {
      return
    }

    const timeoutId = setTimeout(() => {
      const element = document.querySelector(hash)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        element.classList.add('bg-primary/5')
        setTimeout(() => element.classList.remove('bg-primary/5'), 2000)
      }
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [post.comments])

  return (
    <div className="py-6">
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
            canEdit={canEdit}
            canDelete={canDelete}
            editReason={editReason}
            deleteReason={deleteReason}
            onDelete={() => setDeleteDialogOpen(true)}
            isEditing={isEditingPost}
            onEditStart={() => setIsEditingPost(true)}
            onEditSave={editPost}
            onEditCancel={() => setIsEditingPost(false)}
            isSaving={isSavingEdit}
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
              tags={post.tags}
              roadmaps={post.roadmaps}
            />
          </Suspense>
        </div>
      </div>

      {/* Comments card */}
      <div className="bg-card border border-border/40 rounded-lg overflow-hidden mt-4">
        <Suspense fallback={<CommentsSectionSkeleton />}>
          <CommentsSection
            postId={postId}
            comments={post.comments}
            pinnedCommentId={post.pinnedCommentId}
            disableCommenting={!!post.mergeInfo || !!post.isCommentsLocked}
            lockedMessage={post.isCommentsLocked ? 'Comments are locked on this post' : undefined}
          />
        </Suspense>
      </div>

      <DeletePostDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        postTitle={post.title}
        onConfirm={deletePost}
        isPending={isDeleting}
      />
    </div>
  )
}
