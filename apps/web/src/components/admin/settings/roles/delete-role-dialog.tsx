'use client'

import { useState, useTransition } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { deleteRoleFn } from '@/lib/server/functions/roles'
import type { RoleId } from '@quackback/ids'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: { id: RoleId; name: string; assignmentCount: number }
}

export function DeleteRoleDialog({ open, onOpenChange, role }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const blocked = role.assignmentCount > 0

  const handleConfirm = async () => {
    if (blocked) return
    setError(null)
    setSubmitting(true)
    try {
      await deleteRoleFn({ data: { id: role.id } })
      startTransition(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
        router.invalidate()
      })
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to delete role:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete role')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete role</DialogTitle>
          <DialogDescription>
            Permanently delete <strong>{role.name}</strong>. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {blocked && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2">
            This role has {role.assignmentCount} active assignment
            {role.assignmentCount === 1 ? '' : 's'}. Revoke them before deleting.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={busy || blocked}>
            {busy ? 'Deleting…' : 'Delete role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
