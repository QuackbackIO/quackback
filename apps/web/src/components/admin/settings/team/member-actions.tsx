'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  EllipsisVerticalIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  UserIcon,
  UserGroupIcon,
  UserMinusIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import {
  updateMemberRoleFn,
  removeTeamMemberFn,
  forceSignOutUserFn,
} from '@/lib/server/functions/admin'
import { adminResetTwoFactorFn } from '@/lib/server/functions/admin-reset-two-factor'
import { settingsQueries } from '@/lib/client/queries/settings'

interface MemberActionsProps {
  principalId: string
  userId: string | null
  memberName: string
  memberRole: 'admin' | 'member'
  /** Resolved workspace assignment, when it differs from the legacy mapping. */
  assignedRoleId?: string | null
  isLastAdmin: boolean
}

/** The role choice staged in the confirm dialog. */
interface RoleChoice {
  role: 'admin' | 'member'
  roleId?: string
  label: string
}

export function MemberActions({
  principalId,
  userId,
  memberName,
  memberRole,
  assignedRoleId,
  isLastAdmin,
}: MemberActionsProps) {
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [pendingRole, setPendingRole] = useState<RoleChoice | null>(null)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [resetTfaDialogOpen, setResetTfaDialogOpen] = useState(false)
  const [forceSignOutDialogOpen, setForceSignOutDialogOpen] = useState(false)

  // Custom roles for the submenu. Cached alongside the roles tab query.
  const { data: roles } = useQuery(settingsQueries.roles())
  const customRoles = (roles ?? []).filter((r) => !r.isSystem)

  const canChangeRole = !(memberRole === 'admin' && isLastAdmin)
  const canRemove = !(memberRole === 'admin' && isLastAdmin)

  const handleRoleChange = async () => {
    if (!pendingRole) return
    setIsLoading(true)
    try {
      await updateMemberRoleFn({
        data: { principalId, role: pendingRole.role, roleId: pendingRole.roleId },
      })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'roles'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update role. Try again.")
    } finally {
      setIsLoading(false)
      setPendingRole(null)
    }
  }

  const handleRemove = async () => {
    setIsLoading(true)
    try {
      await removeTeamMemberFn({ data: { principalId } })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove teammate. Try again.")
    } finally {
      setIsLoading(false)
      setRemoveDialogOpen(false)
    }
  }

  const handleResetTfa = async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      await adminResetTwoFactorFn({ data: { userId } })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't reset two-factor authentication."
      )
    } finally {
      setIsLoading(false)
      setResetTfaDialogOpen(false)
    }
  }

  const handleForceSignOut = async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      const result = await forceSignOutUserFn({ data: { userId } })
      toast.success(
        result.revokeCount
          ? `Signed ${memberName} out of ${result.revokeCount} session${result.revokeCount === 1 ? '' : 's'}.`
          : `${memberName} had no active sessions.`
      )
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sign user out')
    } finally {
      setIsLoading(false)
      setForceSignOutDialogOpen(false)
    }
  }

  const holdsCustom = customRoles.some((r) => r.id === assignedRoleId)
  const isCurrent = (choice: { role: 'admin' | 'member'; roleId?: string }) =>
    choice.roleId ? assignedRoleId === choice.roleId : memberRole === choice.role && !holdsCustom

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <EllipsisVerticalIcon className="h-4 w-4" />
            <span className="sr-only">Member actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!canChangeRole} className="gap-2">
              <UserGroupIcon className="h-4 w-4" />
              Change role
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  className="gap-2"
                  disabled={isCurrent({ role: 'admin' })}
                  onClick={() => setPendingRole({ role: 'admin', label: 'Admin' })}
                >
                  <ShieldCheckIcon className="h-4 w-4" />
                  Admin
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  disabled={isCurrent({ role: 'member' })}
                  onClick={() => setPendingRole({ role: 'member', label: 'Member' })}
                >
                  <UserIcon className="h-4 w-4" />
                  Member
                </DropdownMenuItem>
                {customRoles.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Custom</DropdownMenuLabel>
                    {customRoles.map((r) => (
                      <DropdownMenuItem
                        key={r.id}
                        disabled={isCurrent({ role: 'member', roleId: r.id })}
                        onClick={() =>
                          setPendingRole({ role: 'member', roleId: r.id, label: r.name })
                        }
                      >
                        {r.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          {userId ? (
            <DropdownMenuItem onClick={() => setResetTfaDialogOpen(true)} className="gap-2">
              <ShieldExclamationIcon className="h-4 w-4" />
              Reset two-factor
            </DropdownMenuItem>
          ) : null}
          {userId ? (
            <DropdownMenuItem onClick={() => setForceSignOutDialogOpen(true)} className="gap-2">
              <ArrowRightOnRectangleIcon className="h-4 w-4" />
              Sign out everywhere
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setRemoveDialogOpen(true)}
            disabled={!canRemove}
            variant="destructive"
            className="gap-2"
          >
            <UserMinusIcon className="h-4 w-4" />
            Remove from team
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={pendingRole != null}
        onOpenChange={(open) => !open && setPendingRole(null)}
        title={`Change role to ${pendingRole?.label}?`}
        description={
          pendingRole?.role === 'admin' ? (
            <>
              <strong>{memberName}</strong> will be able to manage team settings, members, and all
              workspace configurations.
            </>
          ) : pendingRole?.roleId ? (
            <>
              <strong>{memberName}</strong> will hold the "{pendingRole.label}" role and exactly the
              permissions it grants.
            </>
          ) : (
            <>
              <strong>{memberName}</strong> will no longer be able to manage team settings or
              members.
            </>
          )
        }
        confirmLabel={isLoading ? 'Updating...' : `Change to ${pendingRole?.label ?? ''}`}
        isPending={isLoading}
        onConfirm={handleRoleChange}
      />

      <ConfirmDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title="Remove team member?"
        description={
          <>
            <strong>{memberName}</strong> will be removed from the team and converted to a portal
            user. They will lose access to the admin dashboard but can still interact with the
            feedback portal.
          </>
        }
        variant="destructive"
        confirmLabel={isLoading ? 'Removing...' : 'Remove from team'}
        isPending={isLoading}
        onConfirm={handleRemove}
      />

      <ConfirmDialog
        open={resetTfaDialogOpen}
        onOpenChange={setResetTfaDialogOpen}
        title="Reset two-factor authentication?"
        description={
          <>
            <strong>{memberName}</strong>&apos;s two-factor enrollment will be cleared and any
            trusted devices revoked. They&apos;ll be able to sign in with just their password until
            they re-enroll. Use this only when they&apos;ve lost their authenticator and backup
            codes.
          </>
        }
        variant="destructive"
        confirmLabel={isLoading ? 'Resetting...' : 'Reset two-factor'}
        isPending={isLoading}
        onConfirm={handleResetTfa}
      />

      <ConfirmDialog
        open={forceSignOutDialogOpen}
        onOpenChange={setForceSignOutDialogOpen}
        title="Sign out everywhere?"
        description={
          <>
            All active sessions for <strong>{memberName}</strong> will be revoked. They&apos;ll need
            to sign in again on every device. Use this when an account is compromised, a device is
            lost, or a team member is leaving.
          </>
        }
        variant="destructive"
        confirmLabel={isLoading ? 'Signing out...' : 'Sign out everywhere'}
        isPending={isLoading}
        onConfirm={handleForceSignOut}
      />
    </>
  )
}
