'use client'

import { Suspense, useState } from 'react'
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ModalHeader } from '@/components/shared/modal-header'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
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
      <ModalHeader
        section="Roadmap"
        title={post.title}
        onClose={onClose}
        viewUrl={`/b/${post.board.slug}/posts/${post.id}`}
      />

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
  const search = Route.useSearch()
  const { open, validatedId, close } = useUrlModal<PostId>({
    urlId: urlPostId,
    idPrefix: 'post',
    searchParam: 'post',
    route: '/admin/roadmap',
    search,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="View post"
      hasValidId={!!validatedId}
    >
      {validatedId && (
        <RoadmapModalContent postId={validatedId} currentUser={currentUser} onClose={close} />
      )}
    </UrlModalShell>
  )
}
