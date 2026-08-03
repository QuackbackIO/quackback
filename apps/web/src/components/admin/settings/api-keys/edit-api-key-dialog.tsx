/**
 * Edit dialog for an existing API key. Allows changing name, scopes, and
 * allowed teams/inboxes. Backed by `updateApiKeyFn`.
 */
'use client'

import { useState, useEffect, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { TeamId, InboxId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { updateApiKeyFn } from '@/lib/server/functions/api-keys'
import type { ApiKey } from '@/lib/shared/types'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { InboxPicker } from '@/components/admin/shared/inbox-picker'
import { ScopePicker } from './scope-picker'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: ApiKey
}

export function EditApiKeyDialog({ open, onOpenChange, apiKey }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(apiKey.name)
  const [scopes, setScopes] = useState<string[]>(apiKey.scopes ?? [])
  const [teamIds, setTeamIds] = useState<TeamId[]>((apiKey.allowedTeamIds ?? []) as TeamId[])
  const [inboxIds, setInboxIds] = useState<InboxId[]>((apiKey.allowedInboxIds ?? []) as InboxId[])

  // Reset form when the dialog opens for a (potentially different) key.
  useEffect(() => {
    if (open) {
      setName(apiKey.name)
      setScopes(apiKey.scopes ?? [])
      setTeamIds((apiKey.allowedTeamIds ?? []) as TeamId[])
      setInboxIds((apiKey.allowedInboxIds ?? []) as InboxId[])
      setError(null)
    }
  }, [open, apiKey])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Name is required')
      return
    }

    try {
      await updateApiKeyFn({
        data: {
          id: apiKey.id,
          name: name.trim(),
          scopes,
          allowedTeamIds: teamIds,
          allowedInboxIds: inboxIds,
        },
      })

      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })

      onOpenChange(false)
    } catch (err) {
      console.error('Failed to update API key:', err)
      setError(err instanceof Error ? err.message : 'Failed to update API key')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit API Key</DialogTitle>
          <DialogDescription>
            Adjust the name, scopes, and resource restrictions for this key.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-key-name">Name</Label>
            <Input
              id="edit-key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
              maxLength={255}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Scopes</Label>
            <p className="text-xs text-muted-foreground">
              Permissions the key may exercise. Empty = full legacy access (until acknowledged).
            </p>
            <ScopePicker value={scopes} onChange={setScopes} disabled={isPending} />
          </div>

          <div className="space-y-2">
            <Label>Allowed teams</Label>
            <p className="text-xs text-muted-foreground">
              Empty means any team allowed by the key&apos;s scopes.
            </p>
            <TeamPicker
              multiple
              value={teamIds}
              onValueChange={setTeamIds}
              includeArchived
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label>Allowed inboxes</Label>
            <p className="text-xs text-muted-foreground">
              Empty means any inbox allowed by the key&apos;s scopes.
            </p>
            <InboxPicker
              multiple
              value={inboxIds}
              onValueChange={setInboxIds}
              includeArchived
              disabled={isPending}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
