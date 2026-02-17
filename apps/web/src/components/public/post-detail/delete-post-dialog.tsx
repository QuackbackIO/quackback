'use client'

import { ConfirmDialog } from '@/components/shared/confirm-dialog'

interface DeletePostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  postTitle: string
  onConfirm: () => void
  isPending: boolean
  /** Override the default description text */
  description?: React.ReactNode
}

export function DeletePostDialog({
  open,
  onOpenChange,
  postTitle,
  onConfirm,
  isPending,
  description,
}: DeletePostDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Post"
      description={
        description ?? (
          <>
            Are you sure you want to delete &ldquo;{postTitle}&rdquo;? This action cannot be undone.
          </>
        )
      }
      variant="destructive"
      confirmLabel={isPending ? 'Deleting...' : 'Delete'}
      isPending={isPending}
      onConfirm={onConfirm}
    />
  )
}
