import { createFileRoute } from '@tanstack/react-router'
import { requireWorkspace } from '@/lib/workspace'
import { db, member, user, invitation, eq, ne } from '@/lib/db'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { getBulkUserAvatarData } from '@/lib/avatar'
import { TeamHeader } from '@/app/admin/settings/team/team-header'
import { PendingInvitations } from '@/app/admin/settings/team/pending-invitations'

export const Route = createFileRoute('/admin/settings/team')({
  loader: async () => {
    // Settings is validated in root layout
    const { settings } = await requireWorkspace()

    // Only show team members (owner, admin, member) - exclude portal users (role='user')
    const members = await db
      .select({
        id: member.id,
        role: member.role,
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(ne(member.role, 'user'))

    // Fetch pending invitations
    const pendingInvitations = await db.query.invitation.findMany({
      where: eq(invitation.status, 'pending'),
      orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
    })

    // Get avatar URLs for all team members (base64 for SSR)
    const userIds = members.map((m) => m.userId)
    const avatarMap = await getBulkUserAvatarData(userIds)

    // Format invitations for client component (TypeIDs come directly from DB)
    const formattedInvitations = pendingInvitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      name: inv.name,
      role: inv.role,
      createdAt: inv.createdAt.toISOString(),
      lastSentAt: inv.lastSentAt?.toISOString() || null,
      expiresAt: inv.expiresAt.toISOString(),
    }))

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
              const avatarUrl = avatarMap.get(m.userId as `user_${string}`)

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
