'use client'

import { Suspense, useState, useEffect, useCallback, startTransition } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowTopRightOnSquareIcon,
  LinkIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import { adminQueries } from '@/lib/client/queries/admin'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import {
  MetadataSidebar,
  MetadataSidebarSkeleton,
} from '@/components/public/post-detail/metadata-sidebar'
import { useNavigationContext } from '@/components/admin/feedback/detail/use-navigation-context'
import { useUpdatePost, useUpdatePostStatus, useUpdatePostTags } from '@/lib/client/mutations/posts'
import { usePostDetailKeyboard } from '@/lib/client/hooks/use-post-detail-keyboard'
import { addPostToRoadmapFn, removePostFromRoadmapFn } from '@/lib/server/functions/roadmaps'
import { Route } from '@/routes/admin/feedback'
import {
  ensureTypeId,
  type PostId,
  type StatusId,
  type TagId,
  type RoadmapId,
} from '@quackback/ids'
import type { PostDetails, CurrentUser } from '@/components/admin/feedback/inbox-types'

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
  currentUser: _currentUser,
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
  const [contentJson, setContentJson] = useState<JSONContent | null>(
    (post.contentJson as JSONContent) ?? null
  )
  const [hasInitialized, setHasInitialized] = useState(false)

  // UI state
  const [isUpdating, setIsUpdating] = useState(false)
  const [pendingRoadmapId, setPendingRoadmapId] = useState<string | null>(null)

  // Navigation context
  const navigationContext = useNavigationContext(post.id)

  // Mutations
  const updatePost = useUpdatePost()
  const updateStatus = useUpdatePostStatus()
  const updateTags = useUpdatePostTags()

  // Initialize form with post data
  useEffect(() => {
    if (post && !hasInitialized) {
      setTitle(post.title)
      setContentJson((post.contentJson as JSONContent) ?? null)
      setHasInitialized(true)
    }
  }, [post, hasInitialized])

  // Reset when navigating to different post
  useEffect(() => {
    setTitle(post.title)
    setContentJson((post.contentJson as JSONContent) ?? null)
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

  async function handleCopyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

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
      <header className="sticky top-0 z-20 bg-gradient-to-b from-card/98 to-card/95 backdrop-blur-md border-b border-border/40 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-2">
            <Button
              type="button"
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

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => window.open(`/b/${post.board.slug}/posts/${post.id}`, '_blank')}
              className="gap-1.5 h-8"
            >
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">View</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyLink}
              className="gap-1.5 h-8"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Copy Link</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main content area - 2 column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Content editor */}
        <div className="flex-1 overflow-y-auto p-6">
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
        </div>

        {/* Right: Metadata sidebar */}
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
          />
        </Suspense>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t bg-muted/30 shrink-0">
        <p className="hidden sm:block text-xs text-muted-foreground">
          <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Cmd</kbd>
          <span className="mx-1">+</span>
          <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Enter</kbd>
          <span className="ml-2">to save</span>
        </p>
        <div className="flex items-center gap-2 sm:ml-0 ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={updatePost.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={updatePost.isPending || !hasChanges}
          >
            {updatePost.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
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
        className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Edit post</DialogTitle>
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
