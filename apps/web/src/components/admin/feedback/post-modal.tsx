import { useEffect, Suspense } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { adminQueries } from '@/lib/queries/admin'
import { FeedbackDetailPage } from '@/components/admin/feedback/detail/feedback-detail-page'
import { Route } from '@/routes/admin/feedback'
import { ensureTypeId, type PostId } from '@quackback/ids'
import type { PostDetails, CurrentUser } from '@/components/admin/feedback/inbox-types'
import { Loader2 } from 'lucide-react'

interface PostModalProps {
  postId: string | undefined
  currentUser: CurrentUser
}

function PostModalContent({ postId, currentUser }: { postId: PostId; currentUser: CurrentUser }) {
  const postQuery = useSuspenseQuery(adminQueries.postDetail(postId))
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const statusesQuery = useSuspenseQuery(adminQueries.statuses())
  const roadmapsQuery = useSuspenseQuery(adminQueries.roadmaps())

  return (
    <FeedbackDetailPage
      post={postQuery.data as PostDetails}
      boards={boardsQuery.data}
      tags={tagsQuery.data}
      statuses={statusesQuery.data}
      roadmaps={roadmapsQuery.data}
      currentUser={currentUser}
    />
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

export function PostModal({ postId, currentUser }: PostModalProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const isOpen = !!postId

  // Validate and convert postId
  let validatedPostId: PostId | null = null
  if (postId) {
    try {
      validatedPostId = ensureTypeId(postId, 'post')
    } catch {
      // Invalid post ID - will close modal
    }
  }

  // Prefetch post data when modal opens
  useEffect(() => {
    if (validatedPostId) {
      queryClient.prefetchQuery(adminQueries.postDetail(validatedPostId))
      queryClient.prefetchQuery(adminQueries.roadmaps())
    }
  }, [validatedPostId, queryClient])

  // Close modal by removing post param from URL
  const close = () => {
    const { post: _, ...restSearch } = search
    navigate({
      to: '/admin/feedback',
      search: restSearch,
      replace: true,
    })
  }

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
      // j/k navigation is handled inside FeedbackDetailPage via useNavigationContext
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  if (!validatedPostId) {
    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-5xl h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogTitle className="sr-only">Post details</DialogTitle>
        <Suspense fallback={<LoadingState />}>
          <PostModalContent postId={validatedPostId} currentUser={currentUser} />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}
