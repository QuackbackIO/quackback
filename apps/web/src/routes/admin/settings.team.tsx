import { createFileRoute } from '@tanstack/react-router'
import { BackLink } from '@/components/ui/back-link'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { TeamHeader } from '@/components/admin/settings/team/team-header'
import { PendingInvitations } from '@/components/admin/settings/team/pending-invitations'
import { MemberActions } from '@/components/admin/settings/team/member-actions'
import type { UserId, MemberId } from '@quackback/ids'

export const Route = createFileRoute('/admin/settings/team')({
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { settings, queryClient, member } = context

    // Pre-fetch team data using React Query
    await queryClient.ensureQueryData(settingsQueries.teamMembersAndInvitations())

    return {
      settings,
      currentMember: member as { id: MemberId; role: 'admin' | 'member'; userId: UserId },
    }
  },
  component: TeamPage,
})

function TeamPage() {
  const { settings, currentMember } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const teamDataQuery = useSuspenseQuery(settingsQueries.teamMembersAndInvitations())
  const { members, avatarMap, formattedInvitations } = teamDataQuery.data

  // Calculate if there's only one admin (for disabling actions)
  const adminCount = members.filter((m) => m.role === 'admin').length
  const isLastAdmin = adminCount <= 1

  // Current user is admin
  const isCurrentUserAdmin = currentMember.role === 'admin'

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <TeamHeader workspaceName={settings!.name} />

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
              const isCurrentUser = m.id === currentMember.id
              const showActions = isCurrentUserAdmin && !isCurrentUser

              return (
                <li key={m.id} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar src={avatarUrl} name={m.userName} />
                    <div>
                      <p className="font-medium text-foreground">
                        {m.userName}
                        {isCurrentUser && (
                          <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">{m.userEmail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        m.role === 'admin'
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted/50'
                      }
                    >
                      {m.role}
                    </Badge>
                    {showActions && (
                      <MemberActions
                        memberId={m.id}
                        memberName={m.userName || m.userEmail}
                        memberRole={m.role as 'admin' | 'member'}
                        isLastAdmin={isLastAdmin && m.role === 'admin'}
                      />
                    )}
                  </div>
                </li>
              )
            }
          )}
        </ul>
      </div>
    </div>
  )
}
