/**
 * Linked users tab — manage portal-user links for a contact.
 *
 * Approach:
 * - List existing links (`listLinksForContactFn`) → show userId + linkedAt;
 *   enrich displayName/email via `searchPrincipalsFn({roleFilter:['user']})`
 *   client-side Map keyed by userId.
 * - Add: `<PrincipalPicker roleFilter={['user']}>` returns PrincipalId; we
 *   resolve PrincipalId → UserId via the same map and call `linkContactToUserFn`.
 * - Remove: AlertDialog → `unlinkContactFromUserFn`.
 */
import { useState, useMemo } from 'react'
import { useSuspenseQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ContactId, PrincipalId, UserId } from '@quackback/ids'
import { linkContactToUserFn, unlinkContactFromUserFn } from '@/lib/server/functions/contacts'
import { searchPrincipalsFn } from '@/lib/server/functions/principals'
import { contactQueries } from '@/lib/client/queries/contacts'
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

export function ContactLinkedUsersTab({ contactId }: { contactId: ContactId }) {
  const qc = useQueryClient()
  const { data: links } = useSuspenseQuery(contactQueries.links(contactId))

  // Resolve userId → display info via a single principals query.
  const principalsQuery = useQuery({
    queryKey: ['principals', 'allUsers'],
    queryFn: () => searchPrincipalsFn({ data: { roleFilter: ['user'], limit: 50 } }),
    staleTime: 60_000,
  })
  const userMap = useMemo(() => {
    const m = new Map<
      string,
      { principalId: PrincipalId; displayName: string | null; email: string | null }
    >()
    for (const p of principalsQuery.data ?? []) {
      if (p.userId)
        m.set(p.userId, {
          principalId: p.id,
          displayName: p.displayName,
          email: p.email,
        })
    }
    return m
  }, [principalsQuery.data])

  const linkedUserIds = useMemo(() => links.map((l) => l.userId as UserId), [links])
  const excludePrincipalIds = useMemo(() => {
    const ids: PrincipalId[] = []
    for (const u of linkedUserIds) {
      const info = userMap.get(u)
      if (info) ids.push(info.principalId)
    }
    return ids
  }, [linkedUserIds, userMap])

  const [addPrincipalId, setAddPrincipalId] = useState<PrincipalId | null>(null)

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: contactQueries.links(contactId).queryKey })

  const linkMutation = useMutation({
    mutationFn: (userId: UserId) => linkContactToUserFn({ data: { contactId, userId } }),
    onSuccess: () => {
      setAddPrincipalId(null)
      invalidate()
      toast.success('User linked')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unlinkMutation = useMutation({
    mutationFn: (userId: UserId) => unlinkContactFromUserFn({ data: { contactId, userId } }),
    onSuccess: () => {
      invalidate()
      toast.success('User unlinked')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleAdd = () => {
    if (!addPrincipalId) return
    // Find userId for the picked principalId.
    let resolvedUserId: UserId | null = null
    for (const [uid, info] of userMap.entries()) {
      if (info.principalId === addPrincipalId) {
        resolvedUserId = uid as UserId
        break
      }
    }
    if (!resolvedUserId) {
      toast.error('Selected principal has no associated user')
      return
    }
    linkMutation.mutate(resolvedUserId)
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-sm font-semibold">Linked users</h2>
        <p className="text-xs text-muted-foreground">
          Portal users associated with this contact. Linking ties their authenticated identity to
          ticket history.
        </p>
      </div>

      <PermissionGate permission={PERMISSIONS.ORG_MANAGE}>
        <div className="rounded border border-border/50 p-3 space-y-2">
          <div className="grid grid-cols-[1fr,auto] gap-2 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Add user</label>
              <PrincipalPicker
                value={addPrincipalId}
                onValueChange={setAddPrincipalId}
                roleFilter={['user']}
                excludeIds={excludePrincipalIds}
                placeholder="Pick portal user…"
              />
            </div>
            <Button
              size="sm"
              disabled={!addPrincipalId || linkMutation.isPending}
              onClick={handleAdd}
            >
              Link
            </Button>
          </div>
        </div>
      </PermissionGate>

      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="w-44">Linked at</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                  No linked users yet.
                </TableCell>
              </TableRow>
            ) : (
              links.map((l) => {
                const info = userMap.get(l.userId)
                const label = info?.displayName ?? info?.email ?? l.userId
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6 text-[10px]">
                          {label.slice(0, 2).toUpperCase()}
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="text-sm">{label}</span>
                          {info?.email && info?.displayName && (
                            <span className="text-[11px] text-muted-foreground">{info.email}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(l.linkedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <PermissionGate permission={PERMISSIONS.ORG_MANAGE}>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              aria-label="Unlink user"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Unlink user?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The contact will no longer be associated with this portal user.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => unlinkMutation.mutate(l.userId as UserId)}
                              >
                                Unlink
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
