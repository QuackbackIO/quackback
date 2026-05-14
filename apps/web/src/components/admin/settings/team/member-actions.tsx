'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  EllipsisVerticalIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  UserIcon,
  UserMinusIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import {
  updateMemberRoleFn,
  removeTeamMemberFn,
  forceSignOutUserFn,
} from '@/lib/server/functions/admin'
import { adminResetTwoFactorFn } from '@/lib/server/functions/admin-reset-two-factor'

interface MemberActionsProps {
  principalId: string
  userId: string | null
  memberName: string
  memberRole: 'admin' | 'member'
  isLastAdmin: boolean
}

export function MemberActions({
  principalId,
  userId,
  memberName,
  memberRole,
  isLastAdmin,
}: MemberActionsProps) {
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [resetTfaDialogOpen, setResetTfaDialogOpen] = useState(false)
  const [forceSignOutDialogOpen, setForceSignOutDialogOpen] = useState(false)

  const newRole = memberRole === 'admin' ? 'member' : 'admin'
  const canChangeRole = !(memberRole === 'admin' && isLastAdmin)
  const canRemove = !(memberRole === 'admin' && isLastAdmin)

  const handleRoleChange = async () => {
    setIsLoading(true)
    try {
      await updateMemberRoleFn({ data: { principalId, role: newRole } })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
    } catch (error) {
      console.error('Failed to update role:', error)
      alert(error instanceof Error ? error.message : 'Failed to update role')
    } finally {
      setIsLoading(false)
      setRoleDialogOpen(false)
    }
  }

  const handleRemove = async () => {
    setIsLoading(true)
    try {
      await removeTeamMemberFn({ data: { principalId } })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
    } catch (error) {
      console.error('Failed to remove member:', error)
      alert(error instanceof Error ? error.message : 'Failed to remove team member')
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
      console.error('Failed to reset 2FA:', error)
      alert(error instanceof Error ? error.message : 'Failed to reset two-factor')
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
          <DropdownMenuItem
            onClick={() => setRoleDialogOpen(true)}
            disabled={!canChangeRole}
            className="gap-2"
          >
            {newRole === 'admin' ? (
              <>
                <ShieldCheckIcon className="h-4 w-4" />
                Make admin
              </>
            ) : (
              <>
                <UserIcon className="h-4 w-4" />
                Make member
              </>
            )}
          </DropdownMenuItem>
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
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        title={newRole === 'admin' ? 'Make admin?' : 'Remove admin privileges?'}
        description={
          newRole === 'admin' ? (
            <>
              <strong>{memberName}</strong> will be able to manage team settings, members, and all
              workspace configurations.
            </>
          ) : (
            <>
              <strong>{memberName}</strong> will no longer be able to manage team settings or
              members.
            </>
          )
        }
        confirmLabel={
          isLoading ? 'Updating...' : newRole === 'admin' ? 'Make admin' : 'Remove admin'
        }
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
