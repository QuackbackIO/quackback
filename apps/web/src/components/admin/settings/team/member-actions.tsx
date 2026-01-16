'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  EllipsisVerticalIcon,
  ShieldCheckIcon,
  UserIcon,
  UserMinusIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { updateMemberRoleFn, removeTeamMemberFn } from '@/lib/server-functions/admin'

interface MemberActionsProps {
  memberId: string
  memberName: string
  memberRole: 'admin' | 'member'
  isLastAdmin: boolean
}

export function MemberActions({
  memberId,
  memberName,
  memberRole,
  isLastAdmin,
}: MemberActionsProps) {
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)

  const newRole = memberRole === 'admin' ? 'member' : 'admin'
  const canChangeRole = !(memberRole === 'admin' && isLastAdmin)
  const canRemove = !(memberRole === 'admin' && isLastAdmin)

  const handleRoleChange = async () => {
    setIsLoading(true)
    try {
      await updateMemberRoleFn({ data: { memberId, role: newRole } })
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
      await removeTeamMemberFn({ data: { memberId } })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
    } catch (error) {
      console.error('Failed to remove member:', error)
      alert(error instanceof Error ? error.message : 'Failed to remove team member')
    } finally {
      setIsLoading(false)
      setRemoveDialogOpen(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
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

      {/* Role change confirmation dialog */}
      <AlertDialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {newRole === 'admin' ? 'Make admin?' : 'Remove admin privileges?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {newRole === 'admin' ? (
                <>
                  <strong>{memberName}</strong> will be able to manage team settings, members, and
                  all workspace configurations.
                </>
              ) : (
                <>
                  <strong>{memberName}</strong> will no longer be able to manage team settings or
                  members.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRoleChange} disabled={isLoading}>
              {isLoading ? 'Updating...' : newRole === 'admin' ? 'Make admin' : 'Remove admin'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove member confirmation dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{memberName}</strong> will be removed from the team and converted to a portal
              user. They will lose access to the admin dashboard but can still interact with the
              feedback portal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? 'Removing...' : 'Remove from team'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
