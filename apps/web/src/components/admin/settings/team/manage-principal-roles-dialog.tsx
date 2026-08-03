'use client'

import { useState, useTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { TrashIcon } from '@heroicons/react/24/outline'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import {
  listAssignmentsForPrincipalFn,
  listRolesFn,
  assignRoleFn,
  revokeRoleAssignmentFn,
} from '@/lib/server/functions/roles'
import type { PrincipalId, RoleId, RoleAssignmentId, TeamId } from '@quackback/ids'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  principalId: PrincipalId
  principalName: string
}

export function ManagePrincipalRolesDialog({
  open,
  onOpenChange,
  principalId,
  principalName,
}: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<RoleAssignmentId | null>(null)

  const [pickRoleId, setPickRoleId] = useState<RoleId | null>(null)
  const [pickTeamId, setPickTeamId] = useState<TeamId | null>(null)
  const [granting, setGranting] = useState(false)

  const assignmentsQuery = useQuery({
    queryKey: ['admin', 'principal-roles', principalId],
    queryFn: () => listAssignmentsForPrincipalFn({ data: { principalId } }),
    enabled: open,
  })

  const rolesQuery = useQuery({
    queryKey: ['admin', 'roles', 'list'],
    queryFn: () => listRolesFn(),
    enabled: open,
  })

  const invalidate = () => {
    startTransition(() => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'principal-roles', principalId],
      })
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
      router.invalidate()
    })
  }

  const handleRevoke = async (assignmentId: RoleAssignmentId) => {
    setError(null)
    setBusyId(assignmentId)
    try {
      await revokeRoleAssignmentFn({ data: { assignmentId } })
      invalidate()
    } catch (err) {
      console.error('Failed to revoke role assignment:', err)
      setError(err instanceof Error ? err.message : 'Failed to revoke')
    } finally {
      setBusyId(null)
    }
  }

  const handleGrant = async () => {
    if (!pickRoleId) return
    setError(null)
    setGranting(true)
    try {
      await assignRoleFn({
        data: {
          principalId,
          roleId: pickRoleId,
          teamId: pickTeamId ?? null,
        },
      })
      setPickRoleId(null)
      setPickTeamId(null)
      invalidate()
    } catch (err) {
      console.error('Failed to grant role:', err)
      setError(err instanceof Error ? err.message : 'Failed to grant role')
    } finally {
      setGranting(false)
    }
  }

  const assignments = assignmentsQuery.data ?? []
  const roles = rolesQuery.data ?? []
  const busy = isPending || granting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage roles</DialogTitle>
          <DialogDescription>
            Grants for <strong>{principalName}</strong>. Workspace-wide grants apply everywhere;
            team-scoped grants only apply to that team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Current grants</Label>
            {assignmentsQuery.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : assignments.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">No role grants yet.</div>
            ) : (
              <ul className="rounded-md border border-border/50 divide-y divide-border/50">
                {assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{a.role.name}</span>
                        {a.role.isSystem && (
                          <Badge variant="outline" className="text-[10px]">
                            System
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                        <code className="font-mono">{a.role.key}</code>
                        <span>·</span>
                        {a.teamName ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Team: {a.teamName}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Workspace
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(a.id)}
                      disabled={busy || busyId === a.id}
                      aria-label="Revoke"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 border-t border-border/50 pt-4">
            <Label className="text-xs">Grant a role</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Select
                value={pickRoleId ?? ''}
                onValueChange={(v) => setPickRoleId(v ? (v as RoleId) : null)}
                disabled={busy || rolesQuery.isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      <span className="ml-2 text-[10px] text-muted-foreground font-mono">
                        {r.key}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TeamPicker
                value={pickTeamId}
                onValueChange={setPickTeamId}
                placeholder="Workspace-wide (no team)"
                allowClear
                disabled={busy}
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleGrant} disabled={busy || !pickRoleId}>
                {granting ? 'Granting…' : 'Grant role'}
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
