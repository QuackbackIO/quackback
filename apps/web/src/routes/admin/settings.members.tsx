import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { UsersIcon } from '@heroicons/react/24/solid'
import type { UserId, PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { settingsQueries } from '@/lib/client/queries/settings'
import { readBatch } from '@/lib/client/queries/read-batch'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { MembersTab } from '@/components/admin/settings/team/members-tab'
import { TeamsTab } from '@/components/admin/settings/teams/teams-tab'
import { RolesTab } from '@/components/admin/settings/team/roles-tab'

const TABS = ['members', 'teams', 'roles'] as const
type MembersPageTab = (typeof TABS)[number]

const searchSchema = z.object({
  tab: z.enum(TABS).optional(),
})

export const Route = createFileRoute('/admin/settings/members')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.MEMBER_VIEW)
    const { settings, queryClient, principal } = context
    // The Teams tab lists teams, a read gated on team.manage rather than the
    // page's member.view, so only a viewer who may read them is shown the tab.
    const canManageTeams = !!context.permissions?.includes(PERMISSIONS.TEAM_MANAGE)
    const ensure = readBatch(queryClient)
    await Promise.all([
      ensure(settingsQueries.teamMembersAndInvitations()),
      canManageTeams ? ensure(settingsQueries.teams()) : undefined,
      // Every row's actions menu lists the custom roles (and the Roles tab
      // shows them), under the same member.view gate as the roster.
      ensure(settingsQueries.roles()),
    ])

    return {
      settings,
      currentMember: principal as { id: PrincipalId; role: 'admin' | 'member'; userId: UserId },
      canManageTeams,
    }
  },
  component: MembersPage,
})

function MembersPage() {
  const { settings, currentMember, canManageTeams } = Route.useLoaderData()
  const { tab: requested = 'members' } = Route.useSearch()
  const tab = requested === 'teams' && !canManageTeams ? 'members' : requested
  const navigate = Route.useNavigate()

  const setTab = (value: string) => {
    const next = value as MembersPageTab
    // Keep the default tab's URL clean (no ?tab=members).
    navigate({ search: { tab: next === 'members' ? undefined : next }, replace: true })
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={UsersIcon}
        title="Members & Teams"
        description="Manage who has access to your workspace, organize them into teams, and control what they can do."
      />

      <Tabs value={tab} onValueChange={setTab} variant="line">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          {canManageTeams && <TabsTrigger value="teams">Teams</TabsTrigger>}
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab workspaceName={settings!.name} currentMember={currentMember} />
        </TabsContent>
        {canManageTeams && (
          <TabsContent value="teams">
            <TeamsTab />
          </TabsContent>
        )}
        <TabsContent value="roles">
          <RolesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
