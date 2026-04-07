'use client'

import { Suspense } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery } from '@tanstack/react-query'
import { InformationCircleIcon } from '@heroicons/react/24/outline'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ModalHeader } from '@/components/shared/modal-header'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  MetadataSidebar,
  MetadataSidebarSkeleton,
} from '@/components/public/post-detail/metadata-sidebar'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import { AiSummaryCard } from '@/components/admin/feedback/ai-summary-card'
import {
  toPortalComments,
  getInitialContentJson,
} from '@/components/admin/feedback/detail/post-utils'
import type { PostId, CommentId } from '@quackback/ids'
import type { PostDetails } from '@/lib/shared/types'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'

interface MergePreviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  canonicalPostId: PostId
  duplicatePostId: PostId
}

export function MergePreviewModal({
  open,
  onOpenChange,
  canonicalPostId,
  duplicatePostId,
}: MergePreviewModalProps) {
  return (
    <UrlModalShell
      open={open}
      onOpenChange={onOpenChange}
      srTitle="Merge preview"
      hasValidId={!!canonicalPostId && !!duplicatePostId}
    >
      <MergePreviewContent
        canonicalPostId={canonicalPostId}
        duplicatePostId={duplicatePostId}
        onClose={() => onOpenChange(false)}
      />
    </UrlModalShell>
  )
}

// ─── Inner content (inside Suspense boundary) ───────────────────────

function MergePreviewContent({
  canonicalPostId,
  duplicatePostId,
  onClose,
}: {
  canonicalPostId: PostId
  duplicatePostId: PostId
  onClose: () => void
}) {
  const { data } = useSuspenseQuery(adminQueries.mergePreview(canonicalPostId, duplicatePostId))

  const { session } = useRouteContext({ from: '__root__' })
  const { data: statuses = [] } = useQuery(adminQueries.statuses())
  const { data: roadmaps = [] } = useQuery(adminQueries.roadmaps())
  const adminUser = session?.user ? { name: session.user.name, email: session.user.email } : null

  const post = data.post as PostDetails
  const currentStatus = statuses.find((s) => s.id === post.statusId)
  const postRoadmaps = (post.roadmapIds || [])
    .map((id) => roadmaps.find((r) => r.id === id))
    .filter(Boolean) as Array<{ id: string; name: string; slug: string }>

  const contentJson = getInitialContentJson(post)
  const canonicalComments = toPortalComments(post)

  // Map duplicate comments to PublicCommentView format
  const duplicateComments: PublicCommentView[] = data.duplicateComments.map(
    function mapComment(c): PublicCommentView {
      return {
        id: c.id as CommentId,
        content: c.content,
        authorName: c.authorName,
        principalId: c.principalId,
        createdAt: c.createdAt,
        deletedAt: c.deletedAt ?? null,
        isRemovedByTeam:
          !!c.deletedAt && !!c.deletedByPrincipalId && c.deletedByPrincipalId !== c.principalId,
        parentId: c.parentId as CommentId | null,
        isTeamMember: c.isTeamMember,
        avatarUrl: c.avatarUrl ?? null,
        statusChange: c.statusChange ?? null,
        reactions: c.reactions,
        replies: c.replies.map(mapComment),
      }
    }
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <ModalHeader section="Merge Preview" title={post.title} onClose={onClose} hideCopyLink />

      {/* Main content area - scrollable */}
      <ScrollArea className="flex-1 min-h-0">
        {/* Info banner */}
        <div className="mx-6 mt-4 mb-2 flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
          <InformationCircleIcon className="h-5 w-5 shrink-0 mt-0.5" />
          <span>This is a preview of the merged result. Nothing has changed yet.</span>
        </div>

        {/* 2-column layout */}
        <div className="flex">
          {/* Left: Content, AI, Comments */}
          <div className="flex-1 min-w-0">
            <div className="p-6">
              {/* Title (readonly) */}
              <h1 className="text-2xl font-semibold text-foreground mb-4">{post.title}</h1>

              {/* Rich text editor (readonly) */}
              <RichTextEditor
                value={contentJson || ''}
                disabled
                borderless
                features={{
                  headings: false,
                  images: false,
                  codeBlocks: false,
                  bubbleMenu: false,
                  slashMenu: false,
                  taskLists: false,
                  blockquotes: true,
                  tables: false,
                  dividers: false,
                  embeds: false,
                }}
              />

              {/* AI Summary */}
              <div className="mt-8 space-y-3">
                {post.summaryJson && (
                  <AiSummaryCard
                    summaryJson={post.summaryJson}
                    summaryUpdatedAt={post.summaryUpdatedAt ?? null}
                  />
                )}
              </div>
            </div>

            {/* All comments (canonical + duplicate merged) */}
            <div>
              <Suspense fallback={<CommentsSectionSkeleton />}>
                <CommentsSection
                  postId={canonicalPostId}
                  comments={[...canonicalComments, ...duplicateComments]}
                  pinnedCommentId={post.pinnedCommentId}
                  adminUser={adminUser ?? undefined}
                  disableCommenting
                />
              </Suspense>
            </div>
          </div>

          {/* Right: Metadata sidebar (readonly) */}
          {/* canEdit avoids AuthPopover (uses VoteButton path).
              No edit callbacks → dropdowns render as static badges. */}
          <Suspense fallback={<MetadataSidebarSkeleton variant="card" />}>
            <MetadataSidebar
              postId={canonicalPostId}
              voteCount={post.voteCount}
              status={currentStatus}
              board={post.board}
              authorName={post.authorName}
              authorAvatarUrl={(post.principalId && post.avatarUrls?.[post.principalId]) || null}
              authorPrincipalId={post.principalId}
              createdAt={new Date(post.createdAt)}
              tags={post.tags}
              roadmaps={postRoadmaps}
              canEdit
              hideSubscribe
              votersAdditionalPostIds={[duplicatePostId]}
              votersReadonly
              variant="card"
            />
          </Suspense>
        </div>
      </ScrollArea>

      {/* Footer — Close only */}
      <div className="flex items-center justify-end px-4 sm:px-6 py-3 border-t bg-muted/30 shrink-0">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
