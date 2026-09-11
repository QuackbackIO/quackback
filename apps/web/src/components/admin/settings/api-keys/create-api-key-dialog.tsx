'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { DomainAccessPicker } from '@/components/domain-access-picker'
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
import {
  API_KEY_SCOPES,
  EMPTY_SCOPES_MESSAGE,
  domainAccessLevels,
  scopesFromDomainLevels,
  type DomainAccessLevels,
} from '@/lib/server/domains/api-keys/api-key-scopes'
import type { ApiKey } from '@/lib/shared/types'

interface CreateApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onKeyCreated: (key: ApiKey, plainTextKey: string) => void
}

function defaultLevels(): DomainAccessLevels {
  return domainAccessLevels(API_KEY_SCOPES)
}

export function CreateApiKeyDialog({ open, onOpenChange, onKeyCreated }: CreateApiKeyDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [levels, setLevels] = useState<DomainAccessLevels>(defaultLevels)
  const [error, setError] = useState<string | null>(null)

  const scopes = scopesFromDomainLevels(levels)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Please enter a name for the API key')
      return
    }
    if (scopes.length === 0) {
      setError(EMPTY_SCOPES_MESSAGE)
      return
    }

    try {
      const result = await createApiKeyFn({ data: { name: name.trim(), scopes } })

      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })

      setName('')
      setLevels(defaultLevels())
      onKeyCreated(result.apiKey, result.plainTextKey)
    } catch (err) {
      console.error('Failed to create API key:', err)
      setError(err instanceof Error ? err.message : 'Failed to create API key')
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setName('')
      setLevels(defaultLevels())
      setError(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
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
            <div className="space-y-2">
              <Label>Access</Label>
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <DomainAccessPicker levels={levels} onChange={setLevels} disabled={isPending} />
              </div>
              <p className="text-xs text-muted-foreground">
                The key can only do what you select. Read and write includes lookup in that area.
              </p>
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
            <Button type="submit" disabled={isPending || !name.trim() || scopes.length === 0}>
              {isPending ? 'Creating...' : 'Create Key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
