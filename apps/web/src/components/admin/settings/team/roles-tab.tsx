import { useState } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import type { RoleId } from '@quackback/ids'
import { PERMISSIONS, PERMISSION_CATALOGUE, PERMISSION_CATEGORIES } from '@/lib/shared/permissions'
import { CATEGORY_LABELS } from '@/lib/client/permission-labels'
import { useHasPermission } from '@/lib/client/use-permissions'
import { settingsQueries } from '@/lib/client/queries/settings'
import { createRoleFn, deleteRoleFn, listRolesFn } from '@/lib/server/functions/roles'

/** The serialized shape the roles server fn returns across the boundary. */
type RoleWithMeta = Awaited<ReturnType<typeof listRolesFn>>[number]
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/shared/utils'

/**
 * Roles tab — DB-backed: the four seeded presets (read-only, duplicatable)
 * plus custom roles (editable, deletable). Every affordance that writes is
 * gated on role.manage, render-only; the server functions enforce for real.
 */
export function RolesTab() {
  const { data: roles } = useSuspenseQuery(settingsQueries.roles())
  const canManage = useHasPermission(PERMISSIONS.ROLE_MANAGE)
  const [openRoleId, setOpenRoleId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [duplicateFrom, setDuplicateFrom] = useState<RoleWithMeta | null>(null)
  const [deleting, setDeleting] = useState<RoleWithMeta | null>(null)

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Built-in roles are read-only — duplicate one to customize it. Custom roles can grant any
          mix of permissions you hold yourself.
        </p>
        {canManage && (
          <Button
            size="sm"
            onClick={() => {
              setDuplicateFrom(null)
              setCreateOpen(true)
            }}
          >
            New role
          </Button>
        )}
      </div>

      {roles.map((role) => {
        const granted = new Set(role.permissionKeys)
        const isOpen = openRoleId === role.id
        return (
          <div key={role.id} className="rounded-lg border">
            <div className="flex w-full items-start justify-between gap-3 p-4">
              <button
                type="button"
                onClick={() => setOpenRoleId(isOpen ? null : role.id)}
                className="min-w-0 flex-1 text-left"
                aria-expanded={isOpen}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{role.name}</span>
                  <Badge size="sm" variant={role.isSystem ? 'secondary' : 'outline'}>
                    {role.isSystem ? 'Preset' : 'Custom'}
                  </Badge>
                  <Badge size="sm" variant="secondary">
                    {granted.size} permissions
                  </Badge>
                  {!role.isSystem && role.memberCount > 0 && (
                    <Badge size="sm" variant="secondary">
                      {role.memberCount} member{role.memberCount === 1 ? '' : 's'}
                    </Badge>
                  )}
                  {role.newPermissionKeys.length > 0 && (
                    <Badge size="sm" variant="outline">
                      {role.newPermissionKeys.length} new since last edit
                    </Badge>
                  )}
                </div>
                {role.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                {canManage && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDuplicateFrom(role)
                        setCreateOpen(true)
                      }}
                    >
                      Duplicate
                    </Button>
                    {!role.isSystem && (
                      <>
                        <EditRoleButton roleId={role.id} />
                        <Button variant="outline" size="sm" onClick={() => setDeleting(role)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setOpenRoleId(isOpen ? null : role.id)}
                  aria-label={isOpen ? 'Collapse permissions' : 'Expand permissions'}
                >
                  <ChevronDownIcon
                    className={cn(
                      'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                      isOpen && 'rotate-180'
                    )}
                  />
                </button>
              </div>
            </div>
            {isOpen && (
              <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
                {PERMISSION_CATEGORIES.map((category) => {
                  const permsInCategory = PERMISSION_CATALOGUE.filter(
                    (p) => p.category === category && granted.has(p.key)
                  )
                  if (permsInCategory.length === 0) return null
                  return (
                    <div key={category}>
                      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {CATEGORY_LABELS[category]}
                      </h4>
                      <ul className="space-y-0.5">
                        {permsInCategory.map((p) => (
                          <li key={p.key} className="font-mono text-xs text-foreground/80">
                            {p.key}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={roles}
        initialDuplicateFrom={duplicateFrom}
      />
      <DeleteRoleDialog
        key={deleting?.id ?? 'none'}
        role={deleting}
        roles={roles}
        onOpenChange={() => setDeleting(null)}
      />
    </div>
  )
}

function EditRoleButton({ roleId }: { roleId: RoleId }) {
  const navigate = useNavigate()
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => navigate({ to: '/admin/settings/members/roles/$roleId', params: { roleId } })}
    >
      Edit
    </Button>
  )
}

function CreateRoleDialog({
  open,
  onOpenChange,
  roles,
  initialDuplicateFrom,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: RoleWithMeta[]
  initialDuplicateFrom: RoleWithMeta | null
}) {
  const [name, setName] = useState('')
  const [sourceId, setSourceId] = useState<string>('blank')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Reset per open so a previous duplicate choice doesn't leak into "New role".
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setSourceId(initialDuplicateFrom?.id ?? 'blank')
      setName(initialDuplicateFrom ? `${initialDuplicateFrom.name} copy`.slice(0, 64) : '')
    }
  }

  const create = useMutation({
    mutationFn: () =>
      createRoleFn({
        data: {
          name: name.trim(),
          duplicateFromRoleId: sourceId === 'blank' ? undefined : sourceId,
        },
      }),
    onSuccess: async ({ role, droppedKeys }) => {
      await queryClient.invalidateQueries({ queryKey: ['settings', 'roles'] })
      if (droppedKeys.length > 0) {
        toast.info(
          `${droppedKeys.length} permission${droppedKeys.length === 1 ? '' : 's'} you don't hold ${
            droppedKeys.length === 1 ? 'was' : 'were'
          } left off the duplicate.`
        )
      }
      onOpenChange(false)
      navigate({ to: '/admin/settings/members/roles/$roleId', params: { roleId: role.id } })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't create role. Try again.")
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create role</DialogTitle>
          <DialogDescription>
            Start from an existing role's permissions, or from nothing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support Lead"
            />
          </div>
          <div className="space-y-2">
            <Label>Start from</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Blank — no permissions</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Duplicate {r.name} · {r.permissionKeys.length} permissions
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create & edit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteRoleDialog({
  role,
  roles,
  onOpenChange,
}: {
  role: RoleWithMeta | null
  roles: RoleWithMeta[]
  onOpenChange: () => void
}) {
  const [reassignTo, setReassignTo] = useState<string>('')
  const queryClient = useQueryClient()

  const targets = roles.filter((r) => r.id !== role?.id && r.key !== 'owner')
  const needsReassign = (role?.memberCount ?? 0) > 0

  const remove = useMutation({
    mutationFn: () =>
      deleteRoleFn({
        data: {
          roleId: role!.id,
          reassignToRoleId: needsReassign ? reassignTo : undefined,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings', 'roles'] })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
      toast.success('Role deleted')
      onOpenChange()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't delete role. Try again.")
    },
  })

  return (
    <Dialog open={role != null} onOpenChange={(v) => !v && onOpenChange()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete "{role?.name}"?</DialogTitle>
          <DialogDescription>
            {needsReassign
              ? `${role?.memberCount} member${role?.memberCount === 1 ? '' : 's'} hold this role. Choose the role they should move to — they keep workspace access either way.`
              : 'Nobody holds this role. This removes it permanently.'}
          </DialogDescription>
        </DialogHeader>
        {needsReassign && (
          <div className="space-y-2">
            <Label>Reassign members to</Label>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending || (needsReassign && !reassignTo)}
          >
            {remove.isPending ? 'Deleting…' : needsReassign ? 'Reassign & delete' : 'Delete role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
