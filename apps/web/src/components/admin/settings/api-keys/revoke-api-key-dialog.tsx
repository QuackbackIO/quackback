'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { revokeApiKeyFn } from '@/lib/server/functions/api-keys'
import type { ApiKey } from '@/lib/server/domains/api-keys'

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
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Revoke API Key"
      description={
        <>
          Are you sure you want to revoke the API key <strong>{apiKey.name}</strong>?
        </>
      }
      warning={{
        title: 'This action cannot be undone',
        description:
          'Any applications using this key will immediately lose access to the API. You will need to create a new key and update your integrations.',
      }}
      variant="destructive"
      confirmLabel={isPending ? 'Revoking...' : 'Revoke Key'}
      isPending={isPending}
      onConfirm={handleRevoke}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
    </ConfirmDialog>
  )
}
