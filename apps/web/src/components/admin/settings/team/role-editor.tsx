import { useEffect, useMemo, useState } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  PERMISSION_CATALOGUE,
  PERMISSION_CATEGORIES,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/shared/permissions'
import { CATEGORY_LABELS } from '@/lib/client/permission-labels'
import { usePermissions, useHasPermission } from '@/lib/client/use-permissions'
import { settingsQueries } from '@/lib/client/queries/settings'
import { createRoleFn, updateRoleFn, deleteRoleFn, listRolesFn } from '@/lib/server/functions/roles'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { BackLink } from '@/components/ui/back-link'
import { SearchInput } from '@/components/shared/search-input'
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
import { CUSTOM_ROLE_BADGE } from './role-ui'

type RoleWithMeta = Awaited<ReturnType<typeof listRolesFn>>['roles'][number]

type RoleEditorProps =
  | { mode: 'edit'; roleId: string }
  | { mode: 'create'; duplicateFromId?: string }

const ROLES_TAB = { to: '/admin/settings/members', search: { tab: 'roles' } } as const

/**
 * Full-page create / edit / view surface for a role, shared by /roles/new and
 * /roles/:roleId. Custom roles are editable by role.manage holders; system
 * presets and viewers without role.manage see the same page read-only. Create
 * mode adds a Start-from band that stages a source role into the grid.
 */
export function RoleEditor(props: RoleEditorProps) {
  const { data } = useSuspenseQuery(settingsQueries.roles())
  const held = usePermissions()
  const canManage = useHasPermission(PERMISSIONS.ROLE_MANAGE)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isCreate = props.mode === 'create'
  const role = props.mode === 'edit' ? data.roles.find((r) => r.id === props.roleId) : undefined
  // Presets are never editable; neither is anything for a viewer without
  // role.manage. Read-only shows the same page with inputs and toggles frozen.
  const readOnly = !isCreate && (!!role?.isSystem || !canManage)

  // Create mode: which role (if any) seeds the grid. An unresolvable ?from
  // falls back to blank so the Select shows a real value.
  const [sourceId, setSourceId] = useState<string>(() => {
    if (!isCreate || !props.duplicateFromId) return 'blank'
    return data.roles.some((r) => r.id === props.duplicateFromId) ? props.duplicateFromId : 'blank'
  })
  const sourceRole =
    isCreate && sourceId !== 'blank' ? data.roles.find((r) => r.id === sourceId) : null

  const [name, setName] = useState(
    isCreate ? (sourceRole ? `${sourceRole.name} copy`.slice(0, 64) : '') : (role?.name ?? '')
  )
  const [description, setDescription] = useState(role?.description ?? '')
  const [selected, setSelected] = useState<Set<PermissionKey>>(() =>
    isCreate
      ? stageFrom(sourceRole, held)
      : new Set((role?.permissionKeys ?? []) as PermissionKey[])
  )
  const [search, setSearch] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Collapsed by default; categories carrying newly-shipped keys start open so
  // the New badges are seen. Searching expands every matching category.
  const [openCats, setOpenCats] = useState<Set<string>>(
    () =>
      new Set(
        PERMISSION_CATALOGUE.filter((p) => (role?.newPermissionKeys ?? []).includes(p.key)).map(
          (p) => p.category
        )
      )
  )

  const newKeys = useMemo(
    () => new Set((role?.newPermissionKeys ?? []) as PermissionKey[]),
    [role?.newPermissionKeys]
  )

  // Duplicating via ?from stages source∩ceiling on mount; surface any keys the
  // ceiling dropped once (the Select's own toast only fires on re-pick).
  useEffect(() => {
    if (!isCreate || !sourceRole) return
    const dropped = sourceRole.permissionKeys.filter((k) => !held.has(k as PermissionKey)).length
    if (dropped > 0) {
      toast.info(
        `${dropped} permission${dropped === 1 ? '' : 's'} you don't hold ${
          dropped === 1 ? 'was' : 'were'
        } left off.`
      )
    }
    // Mount-only: sourceRole is fixed for the life of this route (key on ?from).
  }, [])

  const onSourceChange = (nextId: string) => {
    setSourceId(nextId)
    const next = nextId === 'blank' ? null : (data.roles.find((r) => r.id === nextId) ?? null)
    setSelected(stageFrom(next, held))
    // Only auto-fill the name while the user hasn't typed their own.
    setName((prev) => (prev === '' || prev === autoName(sourceRole) ? autoName(next) : prev))
    if (next) {
      const dropped = next.permissionKeys.filter((k) => !held.has(k as PermissionKey)).length
      if (dropped > 0) {
        toast.info(
          `${dropped} permission${dropped === 1 ? '' : 's'} you don't hold ${
            dropped === 1 ? 'was' : 'were'
          } left off.`
        )
      }
    }
  }

  const submit = useMutation({
    mutationFn: async (): Promise<void> => {
      if (isCreate) {
        await createRoleFn({
          data: {
            name: name.trim(),
            description: description.trim() || null,
            permissionKeys: [...selected],
          },
        })
      } else {
        await updateRoleFn({
          data: {
            roleId: (props as { roleId: string }).roleId,
            name: name.trim(),
            description: description.trim() || null,
            permissionKeys: [...selected],
          },
        })
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings', 'roles'] })
      toast.success(isCreate ? 'Role created' : 'Role saved')
      navigate(ROLES_TAB)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't save role. Try again.")
    },
  })

  if (props.mode === 'edit' && !role) {
    return <p className="text-sm text-muted-foreground">Role not found.</p>
  }

  const duplicate = () =>
    navigate({ to: '/admin/settings/members/roles/new', search: { from: role?.id } })

  const query = search.trim().toLowerCase()
  const visible = PERMISSION_CATALOGUE.filter((p) => !query || p.key.toLowerCase().includes(query))

  const toggle = (key: PermissionKey) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const countWord = isCreate ? 'selected' : 'granted'

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <BackLink to="/admin/settings/members" search={{ tab: 'roles' }}>
          Roles
        </BackLink>
        {canManage && !isCreate && (
          <Button variant="outline" size="sm" onClick={duplicate}>
            Duplicate
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        {readOnly ? (
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">{role?.name}</h1>
            {role?.description && (
              <p className="text-sm text-muted-foreground">{role.description}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="role-editor-name">Name</Label>
              <Input
                id="role-editor-name"
                className="max-w-xs font-medium"
                value={name}
                maxLength={64}
                placeholder="Support Lead"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-editor-description">Description</Label>
              <Input
                id="role-editor-description"
                className="w-full max-w-md"
                value={description}
                maxLength={280}
                placeholder="What is this role for?"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="flex flex-col items-end gap-1.5 text-right">
          <Badge
            variant={role?.isSystem ? 'subtle' : 'outline'}
            size="sm"
            className={cn(!role?.isSystem && CUSTOM_ROLE_BADGE)}
          >
            {role?.isSystem ? 'Preset' : 'Custom'}
          </Badge>
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {selected.size} of {PERMISSION_CATALOGUE.length} {countWord}
          </span>
        </div>
      </div>

      {isCreate && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3.5 py-2.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Start from
          </Label>
          <Select value={sourceId} onValueChange={onSourceChange}>
            <SelectTrigger size="sm" className="w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blank">Blank — no permissions</SelectItem>
              {data.roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  Duplicate {r.name} · {r.permissionKeys.length} permissions
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            Picking a role stages its permissions below — edit from there.
          </span>
        </div>
      )}

      <div className="max-w-sm">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Filter ${PERMISSION_CATALOGUE.length} permissions…`}
        />
      </div>

      <div className="space-y-3">
        {PERMISSION_CATEGORIES.map((category) => {
          const inCategory = visible.filter((p) => p.category === category)
          if (inCategory.length === 0) return null
          const grantedCount = inCategory.filter((p) => selected.has(p.key)).length
          const togglable = inCategory.filter((p) => held.has(p.key) || selected.has(p.key))
          const allOn = togglable.length > 0 && togglable.every((p) => selected.has(p.key))
          const isOpen = query ? true : openCats.has(category)
          return (
            <div key={category} className="rounded-lg border">
              <div
                className={cn(
                  'flex items-center gap-2.5 bg-muted/40 px-3.5 py-2',
                  isOpen && 'border-b'
                )}
              >
                <Checkbox
                  checked={grantedCount === 0 ? false : allOn ? true : 'indeterminate'}
                  disabled={readOnly || togglable.length === 0}
                  aria-label={`Toggle all ${CATEGORY_LABELS[category]} permissions`}
                  onCheckedChange={(checked) => {
                    setSelected((prev) => {
                      const next = new Set(prev)
                      for (const p of inCategory) {
                        if (checked === true) {
                          if (held.has(p.key)) next.add(p.key)
                        } else {
                          next.delete(p.key)
                        }
                      }
                      return next
                    })
                  }}
                />
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-left"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpenCats((prev) => {
                      const next = new Set(prev)
                      if (next.has(category)) next.delete(category)
                      else next.add(category)
                      return next
                    })
                  }
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABELS[category]}
                  </span>
                  {inCategory.some((p) => newKeys.has(p.key)) && (
                    <Badge size="sm" variant="outline">
                      New
                    </Badge>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {grantedCount} of {inCategory.length}
                  </span>
                </button>
              </div>
              {isOpen && (
                <ul>
                  {inCategory.map((p) => {
                    // Above the editor's ceiling: can't be granted here. Still
                    // removable when already on the role (de-escalation is free).
                    const aboveCeiling = !readOnly && !held.has(p.key) && !selected.has(p.key)
                    return (
                      <li
                        key={p.key}
                        className={cn(
                          'flex items-center gap-2.5 border-b px-3.5 py-1.5 text-[13px] last:border-b-0',
                          aboveCeiling && 'opacity-50'
                        )}
                      >
                        <Checkbox
                          checked={selected.has(p.key)}
                          disabled={readOnly || aboveCeiling}
                          aria-label={p.key}
                          onCheckedChange={() => toggle(p.key)}
                        />
                        <span className="font-mono text-xs">{p.key}</span>
                        {newKeys.has(p.key) && (
                          <Badge size="sm" variant="outline">
                            New
                          </Badge>
                        )}
                        {aboveCeiling && (
                          <span className="ml-auto hidden text-right text-xs text-muted-foreground sm:block">
                            You don't hold this
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 shadow-sm">
          <span className="text-xs text-muted-foreground">
            {selected.size} of {PERMISSION_CATALOGUE.length} {countWord}
            {isCreate && sourceRole && (
              <>
                {' · staged from '}
                <span className="font-medium text-foreground">{sourceRole.name}</span>
              </>
            )}
            {!isCreate && newKeys.size > 0 && (
              <>
                {' · '}
                <span className="font-medium text-foreground">
                  {newKeys.size} permission{newKeys.size === 1 ? '' : 's'} added since last edit
                </span>
              </>
            )}
          </span>
          <div className="flex gap-2">
            {!isCreate && (
              <Button
                variant="outline"
                size="sm"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate(ROLES_TAB)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => submit.mutate()}
              disabled={!name.trim() || submit.isPending}
            >
              {submit.isPending
                ? isCreate
                  ? 'Creating…'
                  : 'Saving…'
                : isCreate
                  ? 'Create role'
                  : 'Save role'}
            </Button>
          </div>
        </div>
      )}

      {role && !isCreate && (
        <DeleteRoleDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          role={role}
          roles={data.roles}
        />
      )}
    </div>
  )
}

function DeleteRoleDialog({
  open,
  onOpenChange,
  role,
  roles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: RoleWithMeta
  roles: RoleWithMeta[]
}) {
  const [reassignTo, setReassignTo] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const needsReassign = role.memberCount > 0
  const targets = roles.filter((r) => r.id !== role.id && r.key !== 'owner')

  const remove = useMutation({
    mutationFn: () =>
      deleteRoleFn({
        data: { roleId: role.id, reassignToRoleId: needsReassign ? reassignTo : undefined },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings', 'roles'] })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
      toast.success('Role deleted')
      navigate(ROLES_TAB)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't delete role. Try again.")
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete "{role.name}"?</DialogTitle>
          <DialogDescription>
            {needsReassign
              ? `${role.memberCount} member${role.memberCount === 1 ? '' : 's'} hold this role. Choose the role they should move to — they keep workspace access either way.`
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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

/** A role's permissions intersected with the editor's ceiling. */
function stageFrom(
  source: RoleWithMeta | null | undefined,
  held: ReadonlySet<PermissionKey>
): Set<PermissionKey> {
  if (!source) return new Set()
  return new Set((source.permissionKeys as PermissionKey[]).filter((k) => held.has(k)))
}

function autoName(source: RoleWithMeta | null | undefined): string {
  return source ? `${source.name} copy`.slice(0, 64) : ''
}
