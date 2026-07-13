'use client'

import { useState, useTransition } from 'react'
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
import { createApiKeyFn } from '@/lib/server/functions/api-keys'
import type { ApiKey } from '@/lib/shared/types'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { InboxPicker } from '@/components/admin/shared/inbox-picker'
import { ScopePicker } from './scope-picker'
import { WarningBox } from '@/components/shared/warning-box'

interface CreateApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onKeyCreated: (key: ApiKey, plainTextKey: string) => void
}

export function CreateApiKeyDialog({ open, onOpenChange, onKeyCreated }: CreateApiKeyDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [teamIds, setTeamIds] = useState<TeamId[]>([])
  const [inboxIds, setInboxIds] = useState<InboxId[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Please enter a name for the API key')
      return
    }

    try {
      const result = await createApiKeyFn({
        data: {
          name: name.trim(),
          scopes,
          allowedTeamIds: teamIds,
          allowedInboxIds: inboxIds,
        },
      })

      // Invalidate queries to refresh the list
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })

      // Reset form and notify parent
      setName('')
      setScopes([])
      setTeamIds([])
      setInboxIds([])
      onKeyCreated(result.apiKey, result.plainTextKey)
    } catch (err) {
      console.error('Failed to create API key:', err)
      setError(err instanceof Error ? err.message : 'Failed to create API key')
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setName('')
      setScopes([])
      setTeamIds([])
      setInboxIds([])
      setError(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Create a new API key to authenticate with the Quackback API.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Production API, Integration Bot"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Give your key a descriptive name so you can identify it later.
              </p>
            </div>

            {scopes.length === 0 && (
              <WarningBox
                variant="warning"
                title="No scopes selected"
                description="Leaving scopes empty grants full legacy access until acknowledged. Pick specific scopes to lock the key down."
              />
            )}

            <div className="space-y-2">
              <Label>Scopes</Label>
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
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? 'Creating...' : 'Create Key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
