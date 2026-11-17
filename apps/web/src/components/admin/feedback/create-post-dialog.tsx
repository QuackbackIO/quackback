import { useState, lazy, Suspense } from 'react'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { NewButton } from '@/components/shared/new-button'
import type { Board, PostTag, PostStatusEntity } from '@/lib/shared/db-types'
import type { CurrentUser } from '@/lib/shared/types/inbox'

// The form (react-hook-form, selects, the editor) loads when the dialog first
// opens, or when the pointer or focus reaches the button, not with the page.
const loadContent = () => import('@/components/admin/feedback/create-post-dialog-content')
const CreatePostDialogContent = lazy(() =>
  loadContent().then((m) => ({ default: m.CreatePostDialogContent }))
)
const preloadContent = () => void loadContent()

interface CreatePostDialogProps {
  boards: Board[]
  tags: PostTag[]
  statuses: PostStatusEntity[]
  currentUser: CurrentUser
  onPostCreated?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}

export function CreatePostDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
  ...props
}: CreatePostDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen
  // Each open mounts a fresh form (a new key), which stays mounted while the
  // dialog animates closed. Nothing mounts before the first open.
  const [session, setSession] = useState(open ? 1 : 0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSession(session + 1)
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => setOpen(isOpen)}>
      {(!isControlled || trigger) && (
        <DialogTrigger asChild onPointerEnter={preloadContent} onFocus={preloadContent}>
          {trigger ?? <NewButton noun="post" />}
        </DialogTrigger>
      )}
      {session > 0 && (
        <Suspense fallback={null}>
          <CreatePostDialogContent key={session} {...props} open={open} setOpen={setOpen} />
        </Suspense>
      )}
    </Dialog>
  )
}
