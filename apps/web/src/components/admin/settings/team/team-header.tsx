import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { UsersIcon, PlusIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { InviteMemberDialog } from '@/components/auth/invite-member-dialog'

interface TeamHeaderProps {
  workspaceName: string
}

export function TeamHeader({ workspaceName }: TeamHeaderProps) {
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const queryClient = useQueryClient()

  const handleInviteSuccess = () => {
    // Invalidate team data to refresh the pending invitations list
    queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
  }

  return (
    <>
      <PageHeader
        icon={UsersIcon}
        title="Team Members"
        description={`Manage who has access to ${workspaceName}`}
        action={
          <Button onClick={() => setShowInviteDialog(true)}>
            <PlusIcon className="h-4 w-4" />
            Invite member
          </Button>
        }
      />

      <InviteMemberDialog
        open={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
        onSuccess={handleInviteSuccess}
      />
    </>
  )
}
