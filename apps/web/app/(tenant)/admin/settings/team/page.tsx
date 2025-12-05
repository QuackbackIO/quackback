import { requireTenant } from '@/lib/tenant'
import { db, member, user, eq } from '@quackback/db'
import { Users, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { getBulkUserAvatarData } from '@/lib/avatar'

export default async function TeamPage() {
  const { organization } = await requireTenant()

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
    .where(eq(member.organizationId, organization.id))

  // Get avatar URLs for all team members (base64 for SSR)
  const userIds = members.map((m) => m.userId)
  const avatarMap = await getBulkUserAvatarData(userIds)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Team Members</h1>
            <p className="text-sm text-muted-foreground">
              Manage who has access to {organization.name}
            </p>
          </div>
        </div>
        <Button>
          <Plus className="h-4 w-4" />
          Invite member
        </Button>
      </div>

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
