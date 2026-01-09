import { useState } from 'react'
import { UsersIcon, PlusIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { InviteMemberDialog } from '@/components/auth/invite-member-dialog'

interface TeamHeaderProps {
  workspaceName: string
}

export function TeamHeader({ workspaceName }: TeamHeaderProps) {
  const [showInviteDialog, setShowInviteDialog] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <UsersIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Team Members</h1>
            <p className="text-sm text-muted-foreground">
              Manage who has access to {workspaceName}
            </p>
          </div>
        </div>
        <Button onClick={() => setShowInviteDialog(true)}>
          <PlusIcon className="h-4 w-4" />
          Invite member
        </Button>
      </div>

      <InviteMemberDialog open={showInviteDialog} onClose={() => setShowInviteDialog(false)} />
    </>
  )
}
