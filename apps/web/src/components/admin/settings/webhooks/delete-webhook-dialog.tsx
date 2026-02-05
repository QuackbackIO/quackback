'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { deleteWebhookFn } from '@/lib/server/functions/webhooks'
import type { Webhook } from '@/lib/server/domains/webhooks'

interface DeleteWebhookDialogProps {
  webhook: Webhook
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteWebhookDialog({ webhook, open, onOpenChange }: DeleteWebhookDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setError(null)

    try {
      await deleteWebhookFn({ data: { webhookId: webhook.id } })

      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] })
        router.invalidate()
      })

      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook')
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Webhook"
      description="Are you sure you want to delete this webhook?"
      warning={{
        title: 'This action cannot be undone',
        description: (
          <>
            The webhook to <code className="bg-muted px-1 rounded text-xs">{webhook.url}</code> will
            be permanently deleted and will no longer receive events.
          </>
        ),
      }}
      variant="destructive"
      confirmLabel={isPending ? 'Deleting...' : 'Delete Webhook'}
      isPending={isPending}
      onConfirm={handleDelete}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
    </ConfirmDialog>
  )
}
