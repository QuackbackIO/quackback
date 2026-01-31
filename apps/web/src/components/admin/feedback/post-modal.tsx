import { Suspense, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { adminQueries } from '@/lib/queries/admin'
import { FeedbackDetailPage } from '@/components/admin/feedback/detail/feedback-detail-page'
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
  // Only post detail needs to suspend - it's the dynamic data
  const postQuery = useSuspenseQuery(adminQueries.postDetail(postId))

  // Reference data is pre-cached in route loader - use regular useQuery for instant access
  const { data: boards = [] } = useQuery(adminQueries.boards())
  const { data: tags = [] } = useQuery(adminQueries.tags())
  const { data: statuses = [] } = useQuery(adminQueries.statuses())
  const { data: roadmaps = [] } = useQuery(adminQueries.roadmaps())

  return (
    <FeedbackDetailPage
      post={postQuery.data as PostDetails}
      boards={boards}
      tags={tags}
      statuses={statuses}
      roadmaps={roadmaps}
      currentUser={currentUser}
      isModal
      onNavigateToPost={onNavigateToPost}
      onClose={onClose}
    />
  )
}

export function PostModal({ postId, currentUser }: PostModalProps) {
  const navigate = useNavigate()
  const isOpen = !!postId

  // Validate and convert postId
  let validatedPostId: PostId | null = null
  if (postId) {
    try {
      validatedPostId = ensureTypeId(postId, 'post')
    } catch {
      // Invalid post ID format - modal won't render
    }
  }

  // Close modal instantly by removing post param from URL
  // Uses functional navigation to avoid search dependency
  const close = useCallback(() => {
    navigate({
      to: '/admin/feedback',
      search: (prev) => {
        const { post: _, ...rest } = prev
        return rest
      },
      replace: true,
    })
  }, [navigate])

  // Navigate to a different post within the modal
  const navigateToPost = useCallback(
    (newPostId: string) => {
      navigate({
        to: '/admin/feedback',
        search: (prev) => ({ ...prev, post: newPostId }),
        replace: true,
      })
    },
    [navigate]
  )

  if (!validatedPostId) {
    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-7xl w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogTitle className="sr-only">Post details</DialogTitle>
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
      </DialogContent>
    </Dialog>
  )
}
