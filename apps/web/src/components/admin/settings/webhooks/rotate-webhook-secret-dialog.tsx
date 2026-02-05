'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { WarningBox } from '@/components/shared/warning-box'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { rotateWebhookSecretFn } from '@/lib/server/functions/webhooks'
import type { Webhook } from '@/lib/server/domains/webhooks'

interface RotateWebhookSecretDialogProps {
  webhook: Webhook
  open: boolean
  onOpenChange: (open: boolean) => void
  onSecretRotated: (secret: string) => void
}

export function RotateWebhookSecretDialog({
  webhook,
  open,
  onOpenChange,
  onSecretRotated,
}: RotateWebhookSecretDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleRotate = async () => {
    setError(null)

    try {
      const result = await rotateWebhookSecretFn({ data: { webhookId: webhook.id } })

      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] })
        router.invalidate()
      })

      onSecretRotated(result.secret)
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to rotate webhook secret:', err)
      setError(err instanceof Error ? err.message : 'Failed to rotate secret')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rotate Signing Secret</DialogTitle>
          <DialogDescription>
            Generate a new signing secret for this webhook endpoint.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <WarningBox
            variant="warning"
            title="The old secret will stop working immediately"
            description="Your endpoint will need to use the new secret to verify webhook signatures. Make sure to update your code before rotating."
          />

          <div className="mt-4 rounded-lg border p-3 bg-muted/30">
            <p className="text-xs text-muted-foreground">
              <strong>Endpoint:</strong>{' '}
              <code className="font-mono text-foreground break-all">{webhook.url}</code>
            </p>
          </div>

          {error && <p className="text-sm text-destructive mt-4">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleRotate} disabled={isPending}>
            {isPending ? 'Rotating...' : 'Rotate Secret'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
