import { requireTenantBySlug } from '@/lib/tenant'
import { db, member, user, eq, and, ne } from '@quackback/db'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { getBulkUserAvatarData } from '@/lib/avatar'
import { TeamHeader } from './team-header'

export default async function TeamPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { organization } = await requireTenantBySlug(orgSlug)

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
    .where(and(eq(member.organizationId, organization.id), ne(member.role, 'user')))

  // Get avatar URLs for all team members (base64 for SSR)
  const userIds = members.map((m) => m.userId)
  const avatarMap = await getBulkUserAvatarData(userIds)

  return (
    <div className="space-y-6">
      <TeamHeader organizationId={organization.id} organizationName={organization.name} />

      {/* Members List */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50">
          <p className="text-sm text-muted-foreground">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>
        <ul className="divide-y divide-border/50">
          {members.map((m) => {
            const avatarUrl = avatarMap.get(m.userId)

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
          })}
        </ul>
      </div>
    </div>
  )
}
