import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { UsersIcon } from '@heroicons/react/24/solid'
import type { UserId, PrincipalId } from '@quackback/ids'
import { settingsQueries } from '@/lib/client/queries/settings'
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
    const { settings, queryClient, principal } = context
    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.teamMembersAndInvitations()),
      queryClient.ensureQueryData(settingsQueries.teams()),
    ])

    return {
      settings,
      currentMember: principal as { id: PrincipalId; role: 'admin' | 'member'; userId: UserId },
    }
  },
  component: MembersPage,
})

function MembersPage() {
  const { settings, currentMember } = Route.useLoaderData()
  const { tab = 'members' } = Route.useSearch()
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
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab workspaceName={settings!.name} currentMember={currentMember} />
        </TabsContent>
        <TabsContent value="teams">
          <TeamsTab />
        </TabsContent>
        <TabsContent value="roles">
          <RolesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
