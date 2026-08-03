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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { updateRoleFn } from '@/lib/server/functions/roles'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: { id: RoleId; name: string; description: string | null }
}

export function RoleEditDialog({ open, onOpenChange, role }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSubmitting(true)
    try {
      await updateRoleFn({
        data: {
          id: role.id,
          name: name.trim(),
          description: description.trim() || null,
        },
      })
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
        router.invalidate()
      })
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to update role:', err)
      setError(err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit role</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="role-edit-name">Name</Label>
            <Input
              id="role-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              autoFocus
              maxLength={128}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-edit-description">Description</Label>
            <Input
              id="role-edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              maxLength={2000}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
