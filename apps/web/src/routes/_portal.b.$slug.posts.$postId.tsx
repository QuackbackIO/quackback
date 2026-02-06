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
  OfficialResponseSection,
  PinnedCommentSection,
} from '@/components/public/post-detail/official-response-section'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import { DeletePostDialog } from '@/components/public/post-detail/delete-post-dialog'
import { usePostPermissions } from '@/lib/client/hooks/use-portal-posts-query'
import { usePostActions } from '@/lib/client/mutations'
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

    // Await only critical data needed for initial render
    // Note: Post detail already includes board data (JOINed), so no separate board query needed
    const [post] = await Promise.all([
      queryClient.ensureQueryData(portalDetailQueries.postDetail(postId)),
      queryClient.ensureQueryData(portalQueries.statuses()),
    ])

    if (!post || post.board.slug !== slug) {
      throw notFound()
    }

    return { settings, postId, slug }
  },
  component: PostDetailPage,
})

function PostDetailPage() {
  const { settings, postId, slug } = Route.useLoaderData()

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
  const workspaceName = settings?.settings?.name ?? 'Team'

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

  function renderHighlightedResponse() {
    if (post.pinnedComment) {
      return <PinnedCommentSection comment={post.pinnedComment} workspaceName={workspaceName} />
    }
    if (post.officialResponse) {
      return (
        <OfficialResponseSection
          content={post.officialResponse.content}
          authorName={post.officialResponse.authorName}
          respondedAt={post.officialResponse.respondedAt}
          workspaceName={workspaceName}
        />
      )
    }
    return null
  }

  return (
    <div className="py-6">
      <UnsubscribeBanner postId={post.id as PostId} />

      <BackLink
        to="/"
        search={{ board: slug }}
        className="mb-6 animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
      >
        {board.name}
      </BackLink>

      <div
        className="bg-card border border-border/40 rounded-lg overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
        style={{ animationDelay: '50ms' }}
      >
        <div className="flex">
          <Suspense fallback={<VoteSidebarSkeleton />}>
            <VoteSidebar postId={postId} voteCount={post.voteCount} />
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

        {renderHighlightedResponse()}

        <div className="bg-muted/20">
          <Suspense fallback={<CommentsSectionSkeleton />}>
            <CommentsSection
              postId={postId}
              comments={post.comments}
              pinnedCommentId={post.pinnedCommentId}
            />
          </Suspense>
        </div>
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
