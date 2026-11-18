import { Component, useState, Suspense, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { NewButton } from '@/components/shared/new-button'
import { lazyWithPreload } from '@/lib/client/lazy-with-preload'
import { toastError } from '@/lib/client/error-notice'
import type { Board, PostTag, PostStatusEntity } from '@/lib/shared/db-types'
import type { CurrentUser } from '@/lib/shared/types/inbox'

// The form (react-hook-form, selects, the editor) loads when the dialog first
// opens, or when the pointer or focus reaches the button, not with the page.
function loadForm() {
  return lazyWithPreload(
    () => import('@/components/admin/feedback/create-post-dialog-content'),
    'CreatePostDialogContent'
  )
}
// React keeps a failed lazy component failed, so a failure swaps in a fresh
// one and the next open tries the import again.
let form = loadForm()
const preloadForm = () => form.preload()

const CONTENT_CLASS = 'w-[95vw] max-w-5xl p-0 gap-0 overflow-hidden'

/** Keeps a form that failed to load (or crashed) inside the dialog. */
class FormBoundary extends Component<
  { onError: (error: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

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

  function handleLoadError(error: unknown) {
    form = loadForm()
    setOpen(false)
    toastError(error, "Couldn't open the new post form")
  }

  const Form = form.Component
  return (
    <Dialog open={open} onOpenChange={(isOpen) => setOpen(isOpen)}>
      {(!isControlled || trigger) && (
        <DialogTrigger asChild onPointerEnter={preloadForm} onFocus={preloadForm}>
          {trigger ?? <NewButton noun="post" />}
        </DialogTrigger>
      )}
      {session > 0 && (
        <FormBoundary key={session} onError={handleLoadError}>
          <Suspense
            fallback={
              <DialogContent className={CONTENT_CLASS}>
                <DialogTitle className="sr-only">Create new post</DialogTitle>
                <div className="min-h-[420px] animate-pulse bg-muted/20" aria-busy="true" />
              </DialogContent>
            }
          >
            <Form {...props} open={open} setOpen={setOpen} />
          </Suspense>
        </FormBoundary>
      )}
    </Dialog>
  )
}
