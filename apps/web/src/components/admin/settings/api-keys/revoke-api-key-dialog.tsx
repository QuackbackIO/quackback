'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { ApiKey } from '@/lib/shared/types'
import type { ApiKeyRefusal } from '@/lib/shared/api-key-refusal'

export type RevokeApiKeyAction = (
  id: ApiKey['id']
) => Promise<{ ok: true; id: ApiKey['id'] } | ApiKeyRefusal>

interface RevokeApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: Pick<ApiKey, 'id' | 'name'>
  /** The server call that revokes this kind of key. */
  revoke: RevokeApiKeyAction
}

export function RevokeApiKeyDialog({
  open,
  onOpenChange,
  apiKey,
  revoke,
}: RevokeApiKeyDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleRevoke = async () => {
    setError(null)

    try {
      const result = await revoke(apiKey.id)
      if (!result.ok) {
        setError(result.message)
        return
      }

      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })

      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key')
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Revoke API key"
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
      confirmLabel={isPending ? 'Revoking...' : 'Revoke key'}
      isPending={isPending}
      onConfirm={handleRevoke}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
    </ConfirmDialog>
  )
}
