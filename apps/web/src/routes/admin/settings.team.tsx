import { createFileRoute } from '@tanstack/react-router'
import { requireWorkspace } from '@/lib/workspace'
import { fetchTeamMembersAndInvitations } from '@/lib/server-functions/settings'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { TeamHeader } from '@/app/admin/settings/team/team-header'
import { PendingInvitations } from '@/app/admin/settings/team/pending-invitations'
import type { UserId } from '@quackback/ids'

export const Route = createFileRoute('/admin/settings/team')({
  loader: async () => {
    // Settings is validated in root layout
    const { settings } = await requireWorkspace()

    const { members, avatarMap, formattedInvitations } = await fetchTeamMembersAndInvitations()

    return {
      settings,
      members,
      avatarMap,
      formattedInvitations,
    }
  },
  component: TeamPage,
})

function TeamPage() {
  const { settings, members, avatarMap, formattedInvitations } = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <TeamHeader workspaceName={settings.name} />

      {/* Pending Invitations */}
      <PendingInvitations invitations={formattedInvitations} />

      {/* Members List */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50">
          <p className="text-sm text-muted-foreground">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>
        <ul className="divide-y divide-border/50">
          {members.map(
            (m: {
              id: string
              role: string
              userId: string
              userName: string
              userEmail: string
            }) => {
              const avatarUrl = avatarMap[m.userId as UserId]

              return (
                <li key={m.id} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar src={avatarUrl} name={m.userName} />
                    <div>
                      <p className="font-medium text-foreground">{m.userName}</p>
                      <p className="text-sm text-muted-foreground">{m.userEmail}</p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      m.role === 'owner'
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'bg-muted/50'
                    }
                  >
                    {m.role}
                  </Badge>
                </li>
              )
            }
          )}
        </ul>
      </div>
    </div>
  )
}
