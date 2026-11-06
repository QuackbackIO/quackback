'use client'

import { useState, useTransition } from 'react'
import { useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { ApiKey } from '@/lib/shared/types'
import type { ApiKeyRefusal } from '@/lib/shared/api-key-refusal'
import { ADMIN_KEY_MESSAGES, refusalText, type KeyDialogMessages } from './key-messages'

export type RevokeApiKeyAction = (
  id: ApiKey['id']
) => Promise<{ ok: true; id: ApiKey['id'] } | ApiKeyRefusal>

interface RevokeApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: Pick<ApiKey, 'id' | 'name'>
  /** The server call that revokes this kind of key. */
  revoke: RevokeApiKeyAction
  messages?: KeyDialogMessages
}

export function RevokeApiKeyDialog({
  open,
  onOpenChange,
  apiKey,
  revoke,
  messages = ADMIN_KEY_MESSAGES,
}: RevokeApiKeyDialogProps) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || isPending

  const handleRevoke = async () => {
    setError(null)
    setSaving(true)
    try {
      const result = await revoke(apiKey.id)
      if (!result.ok) {
        setError(refusalText(intl, messages, result.code))
        return
      }
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })
      onOpenChange(false)
    } catch {
      setError(intl.formatMessage(messages.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={intl.formatMessage(messages.revokeTitle)}
      description={intl.formatMessage(messages.revokeDescription, {
        name: <strong>{apiKey.name}</strong>,
      })}
      warning={{
        title: intl.formatMessage(messages.revokeWarningTitle),
        description: intl.formatMessage(messages.revokeWarningDescription),
      }}
      variant="destructive"
      confirmLabel={intl.formatMessage(busy ? messages.revokePending : messages.revokeConfirm)}
      cancelLabel={intl.formatMessage(messages.cancel)}
      isPending={busy}
      onConfirm={handleRevoke}
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </ConfirmDialog>
  )
}
