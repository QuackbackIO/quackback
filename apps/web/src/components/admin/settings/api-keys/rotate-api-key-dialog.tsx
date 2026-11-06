'use client'

import { useState, useTransition } from 'react'
import { useIntl } from 'react-intl'
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
import type { ApiKey } from '@/lib/shared/types'
import type { ApiKeyRefusal } from '@/lib/shared/api-key-refusal'
import { ADMIN_KEY_MESSAGES, refusalText, type KeyDialogMessages } from './key-messages'

export type RotateApiKeyAction = (
  id: ApiKey['id']
) => Promise<{ ok: true; apiKey: ApiKey; plainTextKey: string } | ApiKeyRefusal>

interface RotateApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: Pick<ApiKey, 'id' | 'name'>
  /** The server call that rotates this kind of key. */
  rotate: RotateApiKeyAction
  onKeyRotated: (key: ApiKey, plainTextKey: string) => void
  messages?: KeyDialogMessages
}

export function RotateApiKeyDialog({
  open,
  onOpenChange,
  apiKey,
  rotate,
  onKeyRotated,
  messages = ADMIN_KEY_MESSAGES,
}: RotateApiKeyDialogProps) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || isPending

  const handleRotate = async () => {
    setError(null)
    setSaving(true)
    try {
      const result = await rotate(apiKey.id)
      if (!result.ok) {
        setError(refusalText(intl, messages, result.code))
        return
      }
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })
      onKeyRotated(result.apiKey, result.plainTextKey)
    } catch {
      setError(intl.formatMessage(messages.failed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage(messages.rotateTitle)}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage(messages.rotateDescription, {
              name: <strong>{apiKey.name}</strong>,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <WarningBox
            variant="warning"
            title={intl.formatMessage(messages.rotateWarningTitle)}
            description={intl.formatMessage(messages.rotateWarningDescription)}
          />

          {error && (
            <p role="alert" className="text-sm text-destructive mt-4">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {intl.formatMessage(messages.cancel)}
          </Button>
          <Button onClick={handleRotate} disabled={busy}>
            {intl.formatMessage(busy ? messages.rotatePending : messages.rotateConfirm)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
