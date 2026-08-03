'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { RoleId } from '@quackback/ids'
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
import { ScopePicker } from '@/components/admin/settings/api-keys/scope-picker'
import { createRoleFn } from '@/lib/server/functions/roles'
import type { PermissionKey } from '@/lib/server/domains/authz'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (id: RoleId) => void
}

export function RoleCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()

  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [permissionKeys, setPermissionKeys] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setKey('')
      setName('')
      setDescription('')
      setPermissionKeys([])
      setError(null)
    }
    onOpenChange(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!key.trim() || !name.trim()) {
      setError('Key and name are required')
      return
    }
    setSubmitting(true)
    try {
      const { id } = await createRoleFn({
        data: {
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || null,
          permissionKeys: permissionKeys as PermissionKey[],
        },
      })
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
        router.invalidate()
      })
      onCreated?.(id)
      handleOpenChange(false)
    } catch (err) {
      console.error('Failed to create role:', err)
      setError(err instanceof Error ? err.message : 'Failed to create role')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create role</DialogTitle>
          <DialogDescription>
            Define a new role bundle. Pick the permissions agents holding this role should have.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="role-key">Key</Label>
              <Input
                id="role-key"
                placeholder="trial-supervisor"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={busy}
                maxLength={64}
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground">lowercase, digits, _ or - only</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                placeholder="Trial supervisor"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                maxLength={128}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              placeholder="Optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              maxLength={2000}
            />
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <ScopePicker value={permissionKeys} onChange={setPermissionKeys} disabled={busy} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !key.trim() || !name.trim()}>
              {busy ? 'Creating…' : 'Create role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
