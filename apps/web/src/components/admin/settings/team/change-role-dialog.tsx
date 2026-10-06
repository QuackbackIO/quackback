import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { FormError } from '@/components/shared/form-error'
import { usersKeys } from '@/lib/client/hooks/use-users-queries'
import { updateMemberRoleFn } from '@/lib/server/functions/admin'
import {
  addPeopleErrorCode,
  withArticle,
  type RoleChoice,
} from '@/components/admin/settings/team/add-people'
import {
  RoleNotes,
  RoleSelect,
  roleValueOf,
  useRoleChoice,
} from '@/components/admin/settings/team/role-select'

export interface ChangeRoleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  principalId: string
  personName: string
  current: { role: 'admin' | 'member'; roleId?: string | null }
  canGrantAdmin: boolean
  onChanged?: (role: RoleChoice) => void
}

/** Change a teammate's role from outside the Members table. */
export function ChangeRoleDialog({ open, onOpenChange, ...rest }: ChangeRoleDialogProps) {
  const [session, setSession] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSession((s) => s + 1)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change {rest.personName}&apos;s role</DialogTitle>
        </DialogHeader>
        <ChangeRoleForm key={session} onClose={() => onOpenChange(false)} {...rest} />
      </DialogContent>
    </Dialog>
  )
}

function ChangeRoleForm({
  principalId,
  personName,
  current,
  canGrantAdmin,
  onChanged,
  onClose,
}: Omit<ChangeRoleDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const queryClient = useQueryClient()
  const initial = roleValueOf(current)
  const [value, setValue] = useState(initial)
  const role = useRoleChoice(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null)
  const refused = error?.code === 'GRANT_CEILING'

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateMemberRoleFn({
        data: {
          principalId,
          role: role.role,
          ...(role.roleId ? { roleId: role.roleId } : {}),
        },
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', 'team'] }),
        queryClient.invalidateQueries({ queryKey: ['settings', 'roles'] }),
        queryClient.invalidateQueries({ queryKey: usersKeys.all }),
      ])
      onChanged?.(role)
      toast.success(`${personName} is now ${withArticle(role.label)}.`)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't change the role. Try again."
      setError({ code: addPeopleErrorCode(err), message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {error && !refused && <FormError message={error.message} />}
      <div className="space-y-1.5">
        <Label htmlFor="change-role-select">Role</Label>
        <RoleSelect
          id="change-role-select"
          value={value}
          onValueChange={(v) => {
            setValue(v)
            if (refused) setError(null)
          }}
          canGrantAdmin={canGrantAdmin}
          invalid={refused}
        />
        <RoleNotes role={role} refused={refused} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || value === initial}>
          {saving ? 'Saving...' : 'Change role'}
        </Button>
      </DialogFooter>
    </form>
  )
}
