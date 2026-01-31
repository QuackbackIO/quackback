'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { revokeApiKeyFn } from '@/lib/server-functions/api-keys'
import type { ApiKey } from '@/lib/api-keys'

interface RevokeApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: ApiKey
}

export function RevokeApiKeyDialog({ open, onOpenChange, apiKey }: RevokeApiKeyDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleRevoke = async () => {
    setError(null)

    try {
      await revokeApiKeyFn({ data: { id: apiKey.id } })

      // Invalidate queries to refresh the list
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })

      onOpenChange(false)
    } catch (err) {
      console.error('Failed to revoke API key:', err)
      setError(err instanceof Error ? err.message : 'Failed to revoke API key')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revoke API Key</DialogTitle>
          <DialogDescription>
            Are you sure you want to revoke the API key <strong>{apiKey.name}</strong>?
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Warning */}
          <div className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-4">
            <ExclamationTriangleIcon className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive">This action cannot be undone</p>
              <p className="text-muted-foreground mt-1">
                Any applications using this key will immediately lose access to the API. You will
                need to create a new key and update your integrations.
              </p>
            </div>
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
          <Button variant="destructive" onClick={handleRevoke} disabled={isPending}>
            {isPending ? 'Revoking...' : 'Revoke Key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
