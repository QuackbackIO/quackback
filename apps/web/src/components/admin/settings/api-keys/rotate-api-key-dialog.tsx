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
import { rotateApiKeyFn } from '@/lib/server/functions/api-keys'
import type { ApiKey } from '@/lib/server/domains/api-keys'

interface RotateApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: ApiKey
  onKeyRotated: (key: ApiKey, plainTextKey: string) => void
}

export function RotateApiKeyDialog({
  open,
  onOpenChange,
  apiKey,
  onKeyRotated,
}: RotateApiKeyDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleRotate = async () => {
    setError(null)

    try {
      const result = await rotateApiKeyFn({ data: { id: apiKey.id } })

      // Invalidate queries to refresh the list
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })

      // Notify parent with new key
      onKeyRotated(result.apiKey, result.plainTextKey)
    } catch (err) {
      console.error('Failed to rotate API key:', err)
      setError(err instanceof Error ? err.message : 'Failed to rotate API key')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rotate API Key</DialogTitle>
          <DialogDescription>
            Generate a new secret for the API key <strong>{apiKey.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <WarningBox
            variant="warning"
            title="The old key will stop working immediately"
            description="Any applications using the current key will lose access until you update them with the new key. The key name and settings will be preserved."
          />

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
            {isPending ? 'Rotating...' : 'Rotate Key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
