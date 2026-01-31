import { Suspense, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
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
      isModal
      onNavigateToPost={onNavigateToPost}
      onClose={onClose}
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

  // Close modal by removing post param from URL
  const close = useCallback(() => {
    const { post: _, ...restSearch } = search
    navigate({
      to: '/admin/feedback',
      search: restSearch,
      replace: true,
    })
  }, [navigate, search])

  // Navigate to a different post within the modal
  const navigateToPost = useCallback(
    (newPostId: string) => {
      navigate({
        to: '/admin/feedback',
        search: { ...search, post: newPostId },
        replace: true,
      })
    },
    [navigate, search]
  )

  if (!validatedPostId) {
    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-7xl w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogTitle className="sr-only">Post details</DialogTitle>
        <Suspense fallback={<LoadingState />}>
          <PostModalContent
            postId={validatedPostId}
            currentUser={currentUser}
            onNavigateToPost={navigateToPost}
            onClose={close}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}
