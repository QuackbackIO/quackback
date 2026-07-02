/**
 * Members tab for a team detail page. Lists current memberships enriched via
 * `getPrincipalsByIdsFn`, with inline role select (re-uses upsert
 * `addTeamMemberFn`) and remove action. Add row uses `<PrincipalPicker>`
 * filtered by current member ids.
 */
import { useState, useMemo } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { TeamId, PrincipalId } from '@quackback/ids'
import { addTeamMemberFn, removeTeamMemberFn } from '@/lib/server/functions/teams'
import { getPrincipalsByIdsFn } from '@/lib/server/functions/principals'
import { teamQueries } from '@/lib/client/queries/teams'
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

const ROLES = ['lead', 'member'] as const
type MemberRole = (typeof ROLES)[number]

export function TeamMembersTab({ teamId }: { teamId: TeamId }) {
  const qc = useQueryClient()
  const { data: memberships } = useSuspenseQuery(teamQueries.members(teamId))

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
  const [addRole, setAddRole] = useState<MemberRole>('member')

  const invalidate = () => qc.invalidateQueries({ queryKey: teamQueries.members(teamId).queryKey })

  const addMutation = useMutation({
    mutationFn: () =>
      addTeamMemberFn({
        data: { teamId, principalId: addPrincipalId!, role: addRole },
      }),
    onSuccess: () => {
      setAddPrincipalId(null)
      setAddRole('member')
      invalidate()
      toast.success('Member added')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Role-change reuses addTeamMemberFn (backend is upsert).
  const updateRoleMutation = useMutation({
    mutationFn: (vars: { principalId: PrincipalId; role: MemberRole }) =>
      addTeamMemberFn({
        data: { teamId, principalId: vars.principalId, role: vars.role },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Role updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeMutation = useMutation({
    mutationFn: (principalId: PrincipalId) => removeTeamMemberFn({ data: { teamId, principalId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Member removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-sm font-semibold">Members</h2>
        <p className="text-xs text-muted-foreground">
          Principals belonging to this team. Leads can be referenced by routing rules and SLA
          recipients.
        </p>
      </div>

      <PermissionGate permission={PERMISSIONS.ADMIN_MANAGE_USERS}>
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
              <Select value={addRole} onValueChange={(v) => setAddRole(v as MemberRole)}>
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
                        permission={PERMISSIONS.ADMIN_MANAGE_USERS}
                        fallback={<span className="text-xs text-muted-foreground">{m.role}</span>}
                      >
                        <Select
                          value={m.role}
                          onValueChange={(v) =>
                            updateRoleMutation.mutate({
                              principalId: m.principalId as PrincipalId,
                              role: v as MemberRole,
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
                      <PermissionGate permission={PERMISSIONS.ADMIN_MANAGE_USERS}>
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
                                They will be removed from this team.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => removeMutation.mutate(m.principalId as PrincipalId)}
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
