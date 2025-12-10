'use client'

import { SubmitPostDialog } from './submit-post-dialog'

interface BoardOption {
  id: string
  name: string
  slug: string
}

interface SubmitPostButtonProps {
  boards: BoardOption[]
  defaultBoardId?: string
  allowSubmissions: boolean
  /** User info if authenticated */
  user?: { name: string | null; email: string } | null
}

/**
 * Submit feedback button for public board pages.
 * Shows the submit dialog which handles both authenticated and unauthenticated states.
 */
export function SubmitPostButton({
  boards,
  defaultBoardId,
  allowSubmissions,
  user,
}: SubmitPostButtonProps) {
  // Don't show anything if submissions are disabled
  if (!allowSubmissions) {
    return null
  }

  // Show the dialog - it handles auth state internally
  return <SubmitPostDialog boards={boards} defaultBoardId={defaultBoardId} user={user} />
}
