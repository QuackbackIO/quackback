'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { CheckboxGroup } from '@/components/ui/checkbox-group'
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
  API_KEY_SCOPE_LABELS,
  type ApiKeyScope,
} from '@/lib/server/domains/api-keys/api-key-scopes'
import type { ApiKey } from '@/lib/shared/types'

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
  // Default = every scope checked, matching what a key could do before scopes existed.
  const [scopes, setScopes] = useState<ApiKeyScope[]>([...API_KEY_SCOPES])
  const [error, setError] = useState<string | null>(null)

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope as ApiKeyScope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope as ApiKeyScope]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Please enter a name for the API key')
      return
    }
    if (scopes.length === 0) {
      setError('Select at least one scope')
      return
    }

    try {
      const result = await createApiKeyFn({ data: { name: name.trim(), scopes } })

      // Invalidate queries to refresh the list
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'api-keys'] })
        router.invalidate()
      })

      // Reset form and notify parent
      setName('')
      setScopes([...API_KEY_SCOPES])
      onKeyCreated(result.apiKey, result.plainTextKey)
    } catch (err) {
      console.error('Failed to create API key:', err)
      setError(err instanceof Error ? err.message : 'Failed to create API key')
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setName('')
      setScopes([...API_KEY_SCOPES])
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
              <Label>Scopes</Label>
              <CheckboxGroup
                className="grid grid-cols-2 gap-x-4 gap-y-2"
                items={API_KEY_SCOPES.map((scope) => ({
                  value: scope,
                  label: (
                    <>
                      {API_KEY_SCOPE_LABELS[scope]}{' '}
                      <code className="text-xs text-muted-foreground">{scope}</code>
                    </>
                  ),
                }))}
                selected={scopes}
                onToggle={toggleScope}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                The key can only perform operations covered by its scopes. All scopes are selected
                by default.
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
