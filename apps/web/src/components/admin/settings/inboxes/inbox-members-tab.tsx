/**
 * Members tab for an inbox detail page. Lists current memberships with role
 * inline-edit + remove. Adds members via `<PrincipalPicker>` filtered to
 * exclude already-present principals.
 */
import { useState, useMemo } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { InboxId, PrincipalId, InboxMembershipId } from '@quackback/ids'
import {
  addInboxMembershipFn,
  updateInboxMembershipRoleFn,
  removeInboxMembershipFn,
} from '@/lib/server/functions/inboxes'
import { getPrincipalsByIdsFn } from '@/lib/server/functions/principals'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { TrashIcon } from '@heroicons/react/24/outline'
import { PrincipalPicker } from '@/components/admin/shared/principal-picker'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const ROLES = ['owner', 'agent', 'viewer'] as const
type MembershipRole = (typeof ROLES)[number]

export function InboxMembersTab({ inboxId }: { inboxId: InboxId }) {
  const qc = useQueryClient()
  const { data: memberships } = useSuspenseQuery(inboxQueries.memberships(inboxId))

  const principalIds = useMemo(
    () => memberships.map((m) => m.principalId as PrincipalId),
    [memberships]
  )

  const principalsQuery = useQuery({
    queryKey: ['principals', 'byIds', principalIds],
    queryFn: () => getPrincipalsByIdsFn({ data: { ids: principalIds } }),
    enabled: principalIds.length > 0,
    staleTime: 60_000,
  })
  const principalMap = useMemo(() => {
    const m = new Map<string, { displayName: string | null; avatarUrl: string | null }>()
    for (const p of principalsQuery.data ?? []) {
      m.set(p.id, { displayName: p.displayName, avatarUrl: p.avatarUrl })
    }
    return m
  }, [principalsQuery.data])

  const [addPrincipalId, setAddPrincipalId] = useState<PrincipalId | null>(null)
  const [addRole, setAddRole] = useState<MembershipRole>('agent')

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: inboxQueries.memberships(inboxId).queryKey })

  const addMutation = useMutation({
    mutationFn: () =>
      addInboxMembershipFn({
        data: { inboxId, principalId: addPrincipalId!, role: addRole },
      }),
    onSuccess: () => {
      setAddPrincipalId(null)
      setAddRole('agent')
      invalidate()
      toast.success('Member added')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateRoleMutation = useMutation({
    mutationFn: (vars: { membershipId: InboxMembershipId; role: MembershipRole }) =>
      updateInboxMembershipRoleFn({
        data: { membershipId: vars.membershipId, role: vars.role },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Role updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeMutation = useMutation({
    mutationFn: (membershipId: InboxMembershipId) =>
      removeInboxMembershipFn({ data: { membershipId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Member removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-3 max-w-3xl">
      <div>
        <h2 className="text-sm font-semibold">Members</h2>
        <p className="text-xs text-muted-foreground">
          Principals who have explicit access to this inbox.
        </p>
      </div>

      <PermissionGate permission={PERMISSIONS.INBOX_MANAGE}>
        <div className="rounded border border-border/50 p-3 space-y-2">
          <div className="grid grid-cols-[1fr,140px,auto] gap-2 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Add member</label>
              <PrincipalPicker
                value={addPrincipalId}
                onValueChange={setAddPrincipalId}
                excludeIds={principalIds}
                placeholder="Pick principal…"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <Select value={addRole} onValueChange={(v) => setAddRole(v as MembershipRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={!addPrincipalId || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              Add
            </Button>
          </div>
        </div>
      </PermissionGate>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="w-32">Role</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberships.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                  No members yet.
                </TableCell>
              </TableRow>
            ) : (
              memberships.map((m) => {
                const info = principalMap.get(m.principalId)
                const label = info?.displayName ?? m.principalId
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6 text-[10px]">
                          {info?.avatarUrl ? (
                            <img src={info.avatarUrl} alt="" />
                          ) : (
                            label.slice(0, 2).toUpperCase()
                          )}
                        </Avatar>
                        <span className="text-sm">{label}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <PermissionGate
                        permission={PERMISSIONS.INBOX_MANAGE}
                        fallback={<span className="text-xs text-muted-foreground">{m.role}</span>}
                      >
                        <Select
                          value={m.role}
                          onValueChange={(v) =>
                            updateRoleMutation.mutate({
                              membershipId: m.id as InboxMembershipId,
                              role: v as MembershipRole,
                            })
                          }
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </PermissionGate>
                    </TableCell>
                    <TableCell>
                      <PermissionGate permission={PERMISSIONS.INBOX_MANAGE}>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              aria-label="Remove member"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove member?</AlertDialogTitle>
                              <AlertDialogDescription>
                                They will lose direct access to this inbox.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => removeMutation.mutate(m.id as InboxMembershipId)}
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </PermissionGate>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
