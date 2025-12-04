'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { SubmitPostDialog } from './submit-post-dialog'

interface SubmitPostButtonProps {
  boardId: string
  allowSubmissions: boolean
  isAuthenticated: boolean
}

/**
 * Conditional submit feedback button for public board pages.
 * Shows different UI based on auth state and board settings.
 */
export function SubmitPostButton({
  boardId,
  allowSubmissions,
  isAuthenticated,
}: SubmitPostButtonProps) {
  // Don't show anything if submissions are disabled
  if (!allowSubmissions) {
    return null
  }

  // Show login prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <Button asChild>
        <Link href="/login?callbackUrl=">
          <Plus className="h-4 w-4 mr-2" />
          Sign in to Submit
        </Link>
      </Button>
    )
  }

  // Show the full dialog for authenticated users
  return <SubmitPostDialog boardId={boardId} />
}
