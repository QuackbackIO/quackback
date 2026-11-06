'use client'

import { useState, useTransition } from 'react'
import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ApiKey } from '@/lib/shared/types'
import type { ApiKeyRefusal } from '@/lib/shared/api-key-refusal'

const m = defineMessages({
  title: { id: 'apiKeys.rename.title', defaultMessage: 'Rename key' },
  name: { id: 'apiKeys.form.name', defaultMessage: 'Name' },
  cancel: { id: 'apiKeys.form.cancel', defaultMessage: 'Cancel' },
  save: { id: 'apiKeys.form.save', defaultMessage: 'Save' },
  failed: { id: 'apiKeys.form.saveFailed', defaultMessage: 'The change could not be saved.' },
})

/** The dialog's words; a page in another message area passes its own. */
export type RenameApiKeyMessages = Record<keyof typeof m, MessageDescriptor>

export type RenameApiKeyAction = (
  id: ApiKey['id'],
  name: string
) => Promise<{ ok: true; apiKey: ApiKey } | ApiKeyRefusal>

export function RenameApiKeyDialog({
  open,
  onOpenChange,
  apiKey,
  rename,
  messages = m,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: Pick<ApiKey, 'id' | 'name'>
  rename: RenameApiKeyAction
  messages?: RenameApiKeyMessages
}) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(apiKey.name)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setSaving(true)
    try {
      const result = await rename(apiKey.id, name.trim())
      if (!result.ok) {
        setError(result.message)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage(messages.title)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-2 py-4">
            <Label htmlFor="rename-api-key">{intl.formatMessage(messages.name)}</Label>
            <Input
              id="rename-api-key"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              autoFocus
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
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
            <Button type="submit" disabled={busy || !name.trim()}>
              {intl.formatMessage(messages.save)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
